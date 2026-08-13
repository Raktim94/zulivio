import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthenticatedEmployee, limit = 100) {
    const events = await this.prisma.auditEvent.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    });

    const actorIds = [...new Set(events.map((e) => e.actorId).filter((id): id is string => id !== null))];
    const actors = await this.prisma.employee.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, fullName: true, employeeNumber: true },
    });
    const actorById = new Map(actors.map((a) => [a.id, a]));

    return events.map((e) => ({
      id: e.id,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      metadata: e.metadata,
      createdAt: e.createdAt,
      actor: e.actorId ? (actorById.get(e.actorId) ?? null) : null,
    }));
  }
}
