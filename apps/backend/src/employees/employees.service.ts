import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { formatEmployeeNumber, generateTemporaryPassword } from "../common/credentials";
import { CreateEmployeeDto } from "./dto/create-employee.dto";
import { UpdateEmployeeDto } from "./dto/update-employee.dto";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { rank, rolesBelow } from "../common/roles";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
const MAX_EMPLOYEE_NUMBER_RETRIES = 5;

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

    const email = dto.email.toLowerCase();

    // Login and bootstrap both resolve an employee by email alone, with no
    // organizationId in the lookup, so email is a de facto global identifier
    // even though the DB only enforces @@unique([organizationId, email]).
    // Without this check, two orgs could each create an employee with the
    // same email and login would non-deterministically resolve to whichever
    // row the DB returns first. This narrows but doesn't eliminate the race
    // (see SECURITY_AUDIT_REPORT.md — full fix needs a global unique index,
    // deferred pending a migration).
    const existingEmail = await this.prisma.employee.findFirst({ where: { email } });
    if (existingEmail) {
      throw new BadRequestException("An account with this email already exists");
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.authService.hashPassword(temporaryPassword);

    // employeeNumber is a per-organization sequential number with a
    // @@unique([organizationId, employeeNumber]) constraint, not a DB
    // sequence — under concurrent creates, two requests can both read the
    // same count() and collide. Retry with a fresh count on conflict,
    // same pattern as AssignmentsService.create's assignmentNumber.
    for (let attempt = 0; attempt < MAX_EMPLOYEE_NUMBER_RETRIES; attempt += 1) {
      const existingCount = await this.prisma.employee.count({
        where: { organizationId: actor.organizationId },
      });
      const employeeNumber = formatEmployeeNumber(existingCount + 1);

      try {
        const employee = await this.prisma.$transaction(async (tx) => {
          const created = await tx.employee.create({
            data: {
              organizationId: actor.organizationId,
              employeeNumber,
              fullName: dto.fullName,
              email,
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
      } catch (error) {
        const target = error instanceof Prisma.PrismaClientKnownRequestError
          ? (error.meta?.target as string[] | undefined)
          : undefined;
        const isEmployeeNumberConflict =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === UNIQUE_CONSTRAINT_VIOLATION &&
          target?.includes("employeeNumber");
        const isEmailConflict =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === UNIQUE_CONSTRAINT_VIOLATION &&
          target?.includes("email");

        if (isEmailConflict) {
          throw new BadRequestException("An account with this email already exists");
        }
        if (!isEmployeeNumberConflict || attempt === MAX_EMPLOYEE_NUMBER_RETRIES - 1) {
          throw error;
        }
      }
    }
    // Unreachable: the loop above always returns or throws.
    throw new Error("Failed to allocate an employee number");
  }

  /**
   * Scoped listing: an employee sees themselves plus anyone strictly
   * lower-ranked in the org — never a peer or anyone above, same rank
   * comparison used by edit/reset-password/remove below, so an account is
   * never visible to someone who couldn't also act on it.
   */
  async list(actor: AuthenticatedEmployee) {
    const lowerRanks = rolesBelow(actor.role);

    const employees = await this.prisma.employee.findMany({
      where: {
        organizationId: actor.organizationId,
        OR: [{ id: actor.id }, { role: { in: lowerRanks } }],
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

  /**
   * Permanent, irreversible delete — separate from `remove` (which only
   * separates the employee and keeps their row for history). Only allowed
   * once an employee is already SEPARATED, and only if they have no
   * historical footprint that would need a "Former employee" placeholder:
   * every relation this touches (see the Employee model's relation list in
   * schema.prisma) is either a required FK — in which case we refuse and
   * name what's blocking it, rather than leaving orphaned rows a required
   * column can't legally hold null — or an already-nullable ownership field
   * (Assignment/Lead/Opportunity `ownerId`, self-relation `managerId`),
   * which we clear as part of the purge.
   */
  async purge(actor: AuthenticatedEmployee, employeeId: string) {
    const target = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: actor.organizationId },
    });

    if (!target) {
      throw new NotFoundException("Employee not found in this organization");
    }

    if (rank(target.role) >= rank(actor.role)) {
      throw new ForbiddenException("Cannot permanently delete a peer or higher-ranked employee");
    }

    if (target.employmentStatus !== "SEPARATED") {
      throw new BadRequestException("Only a separated employee can be permanently deleted — remove them first");
    }

    const [
      workSessions,
      trainingResults,
      tipAcknowledgements,
      assignmentsCreated,
      leadsCreated,
      opportunitiesCreated,
      qualityAuditsAsSubject,
      qualityAuditsAsReviewer,
      workflowRuns,
      leadActivities,
      followUpsAssigned,
      followUpsCreated,
    ] = await Promise.all([
      this.prisma.workSession.count({ where: { employeeId } }),
      this.prisma.trainingResult.count({ where: { employeeId } }),
      this.prisma.tipAcknowledgement.count({ where: { employeeId } }),
      this.prisma.assignment.count({ where: { createdById: employeeId } }),
      this.prisma.lead.count({ where: { createdById: employeeId } }),
      this.prisma.opportunity.count({ where: { createdById: employeeId } }),
      this.prisma.qualityAuditResult.count({ where: { employeeId } }),
      this.prisma.qualityAuditResult.count({ where: { reviewerId: employeeId } }),
      this.prisma.workflowRun.count({ where: { employeeId } }),
      this.prisma.leadActivity.count({ where: { actorId: employeeId } }),
      this.prisma.leadFollowUp.count({ where: { assigneeId: employeeId } }),
      this.prisma.leadFollowUp.count({ where: { createdById: employeeId } }),
    ]);

    const blockers: string[] = [];
    const noteIfAny = (count: number, label: string) => {
      if (count > 0) blockers.push(`${count} ${label}`);
    };
    noteIfAny(workSessions, "attendance session(s)");
    noteIfAny(trainingResults, "training record(s)");
    noteIfAny(tipAcknowledgements, "tip acknowledgement(s)");
    noteIfAny(assignmentsCreated, "assignment(s) created");
    noteIfAny(leadsCreated, "lead(s) created");
    noteIfAny(opportunitiesCreated, "opportunit(y/ies) created");
    noteIfAny(qualityAuditsAsSubject, "quality audit result(s) as subject");
    noteIfAny(qualityAuditsAsReviewer, "quality audit result(s) as reviewer");
    noteIfAny(workflowRuns, "workflow run(s)");
    noteIfAny(leadActivities, "lead activity/activities logged");
    noteIfAny(followUpsAssigned, "follow-up(s) assigned");
    noteIfAny(followUpsCreated, "follow-up(s) created");

    if (blockers.length > 0) {
      throw new BadRequestException(
        `Cannot permanently delete ${target.fullName} — they have ${blockers.join(", ")}. ` +
          "Their record must stay to preserve that history; they remain separated and hidden from active work.",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.assignment.updateMany({ where: { ownerId: employeeId }, data: { ownerId: null } });
      await tx.lead.updateMany({ where: { ownerId: employeeId }, data: { ownerId: null } });
      await tx.opportunity.updateMany({ where: { ownerId: employeeId }, data: { ownerId: null } });
      await tx.employee.updateMany({ where: { managerId: employeeId }, data: { managerId: null } });
      await tx.session.deleteMany({ where: { employeeId } });
      await tx.apiKey.deleteMany({ where: { employeeId } });

      await tx.auditEvent.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          action: "employee.purged",
          targetType: "employee",
          targetId: employeeId,
          metadata: { fullName: target.fullName, employeeNumber: target.employeeNumber },
        },
      });

      await tx.employee.delete({ where: { id: employeeId } });
    });

    return { ok: true };
  }
}
