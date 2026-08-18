import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, QualityAuditStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { isManagerOrAbove } from "../common/roles";
import { EmployeeScopeService } from "../common/scope.service";
import { CreateQualityAuditDefinitionDto } from "./dto/create-quality-audit-definition.dto";
import { CreateQualityAuditResultDto } from "./dto/create-quality-audit-result.dto";

@Injectable()
export class QualityAuditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeeScope: EmployeeScopeService,
  ) {}

  private assertReviewer(actor: AuthenticatedEmployee) {
    if (!isManagerOrAbove(actor.role)) {
      throw new ForbiddenException("Only managers and above can author quality audits");
    }
  }

  async createDefinition(actor: AuthenticatedEmployee, dto: CreateQualityAuditDefinitionDto) {
    this.assertReviewer(actor);
    return this.prisma.qualityAuditDefinition.create({
      data: {
        organizationId: actor.organizationId,
        name: dto.name,
        description: dto.description,
        sections: dto.sections as unknown as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
        createdById: actor.id,
      },
    });
  }

  async listDefinitions(actor: AuthenticatedEmployee) {
    this.assertReviewer(actor);
    return this.prisma.qualityAuditDefinition.findMany({
      where: { organizationId: actor.organizationId, isActive: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /** A DRAFT result, scored against a definition, for one employee within the reviewer's authorized scope. */
  async createResult(actor: AuthenticatedEmployee, dto: CreateQualityAuditResultDto) {
    this.assertReviewer(actor);

    if (!(await this.employeeScope.isInScope(actor, dto.employeeId))) {
      throw new ForbiddenException("Target employee is outside your authorized scope");
    }

    const definition = await this.prisma.qualityAuditDefinition.findFirst({
      where: { id: dto.definitionId, organizationId: actor.organizationId },
    });
    if (!definition) throw new BadRequestException("definitionId does not belong to this organization");

    return this.prisma.qualityAuditResult.create({
      data: {
        organizationId: actor.organizationId,
        definitionId: dto.definitionId,
        employeeId: dto.employeeId,
        reviewerId: actor.id,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        overallScore: dto.overallScore,
        sectionScores: dto.sectionScores as unknown as Prisma.InputJsonValue,
        feedback: dto.feedback,
        status: QualityAuditStatus.DRAFT,
      },
    });
  }

  /** Results the reviewer is authorized to see: their authorized scope, or a specific in-scope employeeId. */
  async listResults(actor: AuthenticatedEmployee, employeeId?: string) {
    this.assertReviewer(actor);

    if (employeeId && !(await this.employeeScope.isInScope(actor, employeeId))) {
      throw new ForbiddenException("Target employee is outside your authorized scope");
    }

    const scopeIds = employeeId ? [employeeId] : await this.employeeScope.authorizedEmployeeIds(actor);

    return this.prisma.qualityAuditResult.findMany({
      where: { organizationId: actor.organizationId, employeeId: { in: scopeIds } },
      include: {
        definition: { select: { id: true, name: true } },
        employee: { select: { id: true, fullName: true, employeeNumber: true } },
        reviewer: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async publish(actor: AuthenticatedEmployee, id: string) {
    this.assertReviewer(actor);

    const result = await this.prisma.qualityAuditResult.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!result) throw new NotFoundException("Quality audit result not found");
    if (!(await this.employeeScope.isInScope(actor, result.employeeId))) {
      throw new ForbiddenException("Target employee is outside your authorized scope");
    }

    return this.prisma.qualityAuditResult.update({
      where: { id },
      data: { status: QualityAuditStatus.PUBLISHED },
    });
  }

  /** Self-scoped: the employee's own published results only — never a draft. */
  async myResults(actor: AuthenticatedEmployee) {
    return this.prisma.qualityAuditResult.findMany({
      where: { organizationId: actor.organizationId, employeeId: actor.id, status: QualityAuditStatus.PUBLISHED },
      include: {
        definition: { select: { id: true, name: true } },
        reviewer: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async acknowledge(actor: AuthenticatedEmployee, id: string) {
    const result = await this.prisma.qualityAuditResult.findFirst({
      where: { id, organizationId: actor.organizationId, employeeId: actor.id },
    });
    if (!result) throw new NotFoundException("Quality audit result not found");
    if (result.status !== QualityAuditStatus.PUBLISHED) {
      throw new BadRequestException("Cannot acknowledge a draft result");
    }

    return this.prisma.qualityAuditResult.update({
      where: { id },
      data: { acknowledgedAt: new Date() },
    });
  }
}
