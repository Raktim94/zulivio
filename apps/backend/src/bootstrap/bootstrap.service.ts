import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { formatEmployeeNumber } from "../common/credentials";
import { BootstrapDto } from "./dto/bootstrap.dto";

/**
 * Creates a brand new Organization plus its first MASTER_OWNER employee.
 * This is the only endpoint that can create an employee without an
 * authenticated actor, so it never trusts a caller-supplied role or
 * organizationId — the org is always freshly created here.
 *
 * Set BOOTSTRAP_DISABLED=true once initial rollout is finished to close
 * self-service org creation entirely (e.g. a single-tenant self-hosted
 * deployment that never needs a second company).
 */
@Injectable()
export class BootstrapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async bootstrap(dto: BootstrapDto) {
    if (process.env.BOOTSTRAP_DISABLED === "true") {
      throw new ForbiddenException("Self-service organization creation is disabled on this instance");
    }

    const existing = await this.prisma.employee.findFirst({ where: { email: dto.email.toLowerCase() } });
    if (existing) {
      throw new BadRequestException("An account with this email already exists");
    }

    const passwordHash = await this.authService.hashPassword(dto.password);

    const org = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({ data: { name: dto.organizationName } });

      const owner = await tx.employee.create({
        data: {
          organizationId: organization.id,
          employeeNumber: formatEmployeeNumber(1),
          fullName: dto.fullName,
          email: dto.email.toLowerCase(),
          passwordHash,
          role: Role.MASTER_OWNER,
          mustChangePassword: false,
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: organization.id,
          actorId: owner.id,
          action: "organization.bootstrapped",
          targetType: "organization",
          targetId: organization.id,
        },
      });

      return { organization, owner };
    });

    return {
      organizationId: org.organization.id,
      employeeId: org.owner.id,
      employeeNumber: org.owner.employeeNumber,
    };
  }
}
