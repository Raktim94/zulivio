import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { CreateAssignmentRuleDto } from "./dto/create-assignment-rule.dto";

const MANAGER_RANK: Role[] = [Role.MANAGER, Role.SALES_HEAD, Role.COMPANY_ADMIN, Role.MASTER_OWNER];

@Injectable()
export class AssignmentRulesService {
  constructor(private readonly prisma: PrismaService) {}

  private requireManager(actor: AuthenticatedEmployee) {
    if (!MANAGER_RANK.includes(actor.role)) {
      throw new ForbiddenException("Only managers and above can manage assignment rules");
    }
  }

  async create(actor: AuthenticatedEmployee, dto: CreateAssignmentRuleDto) {
    this.requireManager(actor);

    const validMembers = await this.prisma.employee.count({
      where: { id: { in: dto.memberIds }, organizationId: actor.organizationId },
    });
    if (validMembers !== dto.memberIds.length) {
      throw new BadRequestException("One or more memberIds do not belong to this organization");
    }

    return this.prisma.assignmentRule.create({
      data: {
        organizationId: actor.organizationId,
        name: dto.name,
        memberIds: dto.memberIds,
        slaMinutes: dto.slaMinutes ?? 60,
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
   * Round-robin pick: advances the rule's cursor atomically so concurrent
   * lead creation never assigns the same slot twice. Returns null if no
   * active rule exists — callers should leave the lead unassigned rather
   * than fail the request.
   */
  async assignNext(organizationId: string): Promise<{ employeeId: string; slaMinutes: number } | null> {
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.assignmentRule.findFirst({
        where: { organizationId, isActive: true },
        orderBy: { createdAt: "asc" },
      });
      if (!rule || rule.memberIds.length === 0) return null;

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
