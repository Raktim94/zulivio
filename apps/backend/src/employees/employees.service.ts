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
