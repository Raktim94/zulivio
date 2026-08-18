import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { isManagerOrAbove } from "../common/roles";
import { CreateTipDto } from "./dto/create-tip.dto";


@Injectable()
export class TipsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actor: AuthenticatedEmployee, dto: CreateTipDto) {
    if (!isManagerOrAbove(actor.role)) {
      throw new ForbiddenException("Only managers and above can publish tips");
    }

    return this.prisma.tip.create({
      data: {
        organizationId: actor.organizationId,
        title: dto.title,
        body: dto.body,
        linkedDocumentId: dto.linkedDocumentId,
        targetRole: dto.targetRole,
        targetDepartment: dto.targetDepartment,
        publishAt: dto.publishAt ? new Date(dto.publishAt) : undefined,
        createdById: actor.id,
      },
    });
  }

  /** Today's tips for the employee front page — targeted by role/department, or broadcast to everyone. */
  async feed(actor: AuthenticatedEmployee) {
    const tips = await this.prisma.tip.findMany({
      where: {
        organizationId: actor.organizationId,
        publishAt: { lte: new Date() },
        OR: [
          { targetRole: null, targetDepartment: null },
          { targetRole: actor.role },
        ],
      },
      include: {
        acknowledgements: { where: { employeeId: actor.id } },
      },
      orderBy: { publishAt: "desc" },
      take: 20,
    });

    return tips.map((t) => ({
      id: t.id,
      title: t.title,
      body: t.body,
      publishAt: t.publishAt,
      acknowledged: t.acknowledgements.length > 0,
    }));
  }

  async acknowledge(actor: AuthenticatedEmployee, tipId: string) {
    const tip = await this.prisma.tip.findFirst({
      where: { id: tipId, organizationId: actor.organizationId },
    });
    if (!tip) throw new NotFoundException("Tip not found");

    return this.prisma.tipAcknowledgement.upsert({
      where: { tipId_employeeId: { tipId, employeeId: actor.id } },
      create: { tipId, employeeId: actor.id },
      update: { acknowledgedAt: new Date() },
    });
  }
}
