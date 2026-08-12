import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { formatEmployeeNumber, generateTemporaryPassword } from "../common/credentials";
import { CreateEmployeeDto } from "./dto/create-employee.dto";
import { UpdateEmployeeDto } from "./dto/update-employee.dto";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";

const HIERARCHY: Role[] = [
  Role.EMPLOYEE,
  Role.MANAGER,
  Role.SALES_HEAD,
  Role.COMPANY_ADMIN,
  Role.MASTER_OWNER,
];

function rank(role: Role): number {
  return HIERARCHY.indexOf(role);
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  /** A creator may only grant roles strictly below their own rank. */
  private assertCanGrantRole(actor: AuthenticatedEmployee, targetRole: Role) {
    if (rank(targetRole) >= rank(actor.role)) {
      throw new ForbiddenException(
        `Role ${actor.role} cannot create an employee with role ${targetRole}`,
      );
    }
  }

  async create(actor: AuthenticatedEmployee, dto: CreateEmployeeDto) {
    this.assertCanGrantRole(actor, dto.role);

    if (dto.managerId) {
      const manager = await this.prisma.employee.findFirst({
        where: { id: dto.managerId, organizationId: actor.organizationId },
      });
      if (!manager) {
        throw new BadRequestException("managerId does not belong to this organization");
      }
    }

    const existingCount = await this.prisma.employee.count({
      where: { organizationId: actor.organizationId },
    });
    const employeeNumber = formatEmployeeNumber(existingCount + 1);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.authService.hashPassword(temporaryPassword);

    const employee = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({
        data: {
          organizationId: actor.organizationId,
          employeeNumber,
          fullName: dto.fullName,
          email: dto.email.toLowerCase(),
          passwordHash,
          role: dto.role,
          department: dto.department,
          managerId: dto.managerId,
          mustChangePassword: true,
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          action: "employee.created",
          targetType: "employee",
          targetId: created.id,
          metadata: { role: dto.role, employeeNumber },
        },
      });

      return created;
    });

    return {
      id: employee.id,
      employeeNumber: employee.employeeNumber,
      fullName: employee.fullName,
      email: employee.email,
      role: employee.role,
      // Returned exactly once, at creation time — never stored or retrievable again.
      temporaryPassword,
    };
  }

  /** Scoped listing: managers see their direct reports + self, everyone above sees the whole org. */
  async list(actor: AuthenticatedEmployee) {
    const managerScoped = actor.role === Role.MANAGER || actor.role === Role.EMPLOYEE;

    const employees = await this.prisma.employee.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(managerScoped
          ? { OR: [{ id: actor.id }, { managerId: actor.id }] }
          : {}),
      },
      select: {
        id: true,
        employeeNumber: true,
        fullName: true,
        email: true,
        role: true,
        department: true,
        employmentStatus: true,
        managerId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return employees;
  }

  /**
   * Full edit capability: role, department, manager, employment status
   * (e.g. reactivating a SUSPENDED/ON_LEAVE employee), name. Guarded the
   * same way as create/remove — the actor must outrank the target's
   * current role AND any new role being granted, so this can never be used
   * to promote someone to a peer or higher rank than the actor.
   */
  async update(actor: AuthenticatedEmployee, employeeId: string, dto: UpdateEmployeeDto) {
    const target = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: actor.organizationId },
    });
    if (!target) {
      throw new NotFoundException("Employee not found in this organization");
    }
    if (rank(target.role) >= rank(actor.role)) {
      throw new ForbiddenException("Cannot edit a peer or higher-ranked employee");
    }
    if (dto.role) {
      this.assertCanGrantRole(actor, dto.role);
    }
    if (dto.managerId) {
      const manager = await this.prisma.employee.findFirst({
        where: { id: dto.managerId, organizationId: actor.organizationId },
      });
      if (!manager) {
        throw new BadRequestException("managerId does not belong to this organization");
      }
    }
    // Separation has its own dedicated flow (`remove`) that also revokes
    // sessions and stamps separatedAt — block it here so this endpoint
    // can't produce a half-separated employee with an active session.
    if (dto.employmentStatus === "SEPARATED") {
      throw new BadRequestException("Use DELETE /employees/:id to separate an employee");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.employee.update({
        where: { id: employeeId },
        data: {
          fullName: dto.fullName,
          role: dto.role,
          department: dto.department,
          managerId: dto.managerId === "" ? null : dto.managerId,
          employmentStatus: dto.employmentStatus,
          // Reactivating from SUSPENDED/ON_LEAVE clears any stale separatedAt.
          separatedAt: dto.employmentStatus ? null : undefined,
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          action: "employee.updated",
          targetType: "employee",
          targetId: employeeId,
          metadata: {
            fullName: dto.fullName ?? null,
            role: dto.role ?? null,
            department: dto.department ?? null,
            managerId: dto.managerId ?? null,
            employmentStatus: dto.employmentStatus ?? null,
          },
        },
      });

      return result;
    });

    return {
      id: updated.id,
      employeeNumber: updated.employeeNumber,
      fullName: updated.fullName,
      role: updated.role,
      department: updated.department,
      employmentStatus: updated.employmentStatus,
      managerId: updated.managerId,
    };
  }

  /**
   * Owner-initiated password reset: generates a new temporary password,
   * forces the target to change it on next login, and revokes all their
   * existing sessions immediately (so a reset actually takes effect, not
   * just on their next natural re-login).
   */
  async resetPassword(actor: AuthenticatedEmployee, employeeId: string) {
    const target = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: actor.organizationId },
    });
    if (!target) {
      throw new NotFoundException("Employee not found in this organization");
    }
    if (rank(target.role) >= rank(actor.role)) {
      throw new ForbiddenException("Cannot reset the password of a peer or higher-ranked employee");
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.authService.hashPassword(temporaryPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { passwordHash, mustChangePassword: true },
      });

      await tx.session.updateMany({
        where: { employeeId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          action: "employee.password_reset",
          targetType: "employee",
          targetId: employeeId,
        },
      });
    });

    // Returned exactly once — never stored or retrievable again.
    return { temporaryPassword };
  }

  async remove(actor: AuthenticatedEmployee, employeeId: string, reason?: string) {
    const target = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: actor.organizationId },
    });

    if (!target) {
      throw new NotFoundException("Employee not found in this organization");
    }

    if (rank(target.role) >= rank(actor.role)) {
      throw new ForbiddenException("Cannot remove a peer or higher-ranked employee");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { employmentStatus: "SEPARATED", separatedAt: new Date() },
      });

      await tx.session.updateMany({
        where: { employeeId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          action: "employee.separated",
          targetType: "employee",
          targetId: employeeId,
          metadata: { reason: reason ?? null },
        },
      });
    });

    return { ok: true };
  }
}
