import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AssignmentRuleMode, LeadStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { isManagerOrAbove } from "../common/roles";
import { CreateAssignmentRuleDto } from "./dto/create-assignment-rule.dto";
import { UpdateAssignmentRuleDto } from "./dto/update-assignment-rule.dto";

const OPEN_LEAD_STATUSES: LeadStatus[] = [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED];

@Injectable()
export class AssignmentRulesService {
  constructor(private readonly prisma: PrismaService) {}

  private requireManager(actor: AuthenticatedEmployee) {
    if (!isManagerOrAbove(actor.role)) {
      throw new ForbiddenException("Only managers and above can manage assignment rules");
    }
  }

  private async validateMembers(actor: AuthenticatedEmployee, memberIds: string[]) {
    const validMembers = await this.prisma.employee.count({
      where: { id: { in: memberIds }, organizationId: actor.organizationId },
    });
    if (validMembers !== memberIds.length) {
      throw new BadRequestException("One or more memberIds do not belong to this organization");
    }
  }

  private validateTerritoryMap(territoryMap: Record<string, string> | undefined, memberIds: string[]) {
    if (!territoryMap) return undefined;
    const normalized: Record<string, string> = {};
    for (const [territory, employeeId] of Object.entries(territoryMap)) {
      if (!memberIds.includes(employeeId)) {
        throw new BadRequestException(
          `territoryMap references employeeId "${employeeId}" which is not in memberIds`,
        );
      }
      normalized[territory.trim().toLowerCase()] = employeeId;
    }
    return normalized;
  }

  async create(actor: AuthenticatedEmployee, dto: CreateAssignmentRuleDto) {
    this.requireManager(actor);
    await this.validateMembers(actor, dto.memberIds);
    const territoryMap = this.validateTerritoryMap(dto.territoryMap, dto.memberIds);

    return this.prisma.assignmentRule.create({
      data: {
        organizationId: actor.organizationId,
        name: dto.name,
        memberIds: dto.memberIds,
        slaMinutes: dto.slaMinutes ?? 60,
        mode: dto.mode ?? AssignmentRuleMode.ROUND_ROBIN,
        territoryMap: territoryMap ?? undefined,
        maxOpenLeads: dto.maxOpenLeads,
      },
    });
  }

  async update(actor: AuthenticatedEmployee, id: string, dto: UpdateAssignmentRuleDto) {
    this.requireManager(actor);
    const rule = await this.prisma.assignmentRule.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!rule) throw new NotFoundException("Assignment rule not found");

    const memberIds = dto.memberIds ?? rule.memberIds;
    if (dto.memberIds) await this.validateMembers(actor, dto.memberIds);
    const territoryMap = dto.territoryMap
      ? this.validateTerritoryMap(dto.territoryMap, memberIds)
      : undefined;

    return this.prisma.assignmentRule.update({
      where: { id },
      data: {
        name: dto.name,
        memberIds: dto.memberIds,
        slaMinutes: dto.slaMinutes,
        mode: dto.mode,
        territoryMap,
        maxOpenLeads: dto.maxOpenLeads,
        // A rule whose member list shrank could point its cursor past the
        // new end; wrapping via modulo in assignNext already handles this
        // safely, so no cursor reset is needed here.
      },
    });
  }

  async list(actor: AuthenticatedEmployee) {
    return this.prisma.assignmentRule.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { createdAt: "asc" },
    });
  }

  async setActive(actor: AuthenticatedEmployee, id: string, isActive: boolean) {
    this.requireManager(actor);
    const rule = await this.prisma.assignmentRule.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!rule) throw new NotFoundException("Assignment rule not found");

    return this.prisma.assignmentRule.update({ where: { id }, data: { isActive } });
  }

  /**
   * Picks the next owner for a new lead per the org's active assignment
   * rule. Returns null if no active rule exists, or (CAPACITY mode) every
   * member is already at their cap — callers should leave the lead
   * unassigned in the overdue/unassigned queue rather than fail the request.
   */
  async assignNext(
    organizationId: string,
    context: { territory?: string } = {},
  ): Promise<{ employeeId: string; slaMinutes: number } | null> {
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.assignmentRule.findFirst({
        where: { organizationId, isActive: true },
        orderBy: { createdAt: "asc" },
      });
      if (!rule || rule.memberIds.length === 0) return null;

      if (rule.mode === AssignmentRuleMode.TERRITORY) {
        const territoryMap = (rule.territoryMap as Record<string, string> | null) ?? {};
        const key = context.territory?.trim().toLowerCase();
        const matched = key ? territoryMap[key] : undefined;
        if (matched && rule.memberIds.includes(matched)) {
          return { employeeId: matched, slaMinutes: rule.slaMinutes };
        }
        // No territory match — fall through to round robin below so the
        // lead is still assigned rather than left orphaned.
      }

      if (rule.mode === AssignmentRuleMode.CAPACITY) {
        const openCounts = await tx.lead.groupBy({
          by: ["ownerId"],
          where: { organizationId, ownerId: { in: rule.memberIds }, status: { in: OPEN_LEAD_STATUSES } },
          _count: { _all: true },
        });
        const countByMember = new Map(rule.memberIds.map((id) => [id, 0]));
        for (const row of openCounts) {
          if (row.ownerId) countByMember.set(row.ownerId, row._count._all);
        }

        let best: { employeeId: string; count: number } | null = null;
        for (const [employeeId, count] of countByMember) {
          if (rule.maxOpenLeads != null && count >= rule.maxOpenLeads) continue;
          if (!best || count < best.count) best = { employeeId, count };
        }
        if (!best) return null; // every member is at capacity

        return { employeeId: best.employeeId, slaMinutes: rule.slaMinutes };
      }

      // ROUND_ROBIN (also the TERRITORY fallback path)
      const index = rule.cursor % rule.memberIds.length;
      const employeeId = rule.memberIds[index];

      await tx.assignmentRule.update({
        where: { id: rule.id },
        data: { cursor: (rule.cursor + 1) % rule.memberIds.length },
      });

      return { employeeId, slaMinutes: rule.slaMinutes };
    });
  }
}
