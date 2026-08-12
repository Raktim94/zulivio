import {
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { EmploymentStatus } from "@prisma/client";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h, matches attendance shift assumptions
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

interface LoginAttemptRecord {
  count: number;
  windowStart: number;
}

@Injectable()
export class AuthService {
  // In-memory best-effort rate limiting. Adequate for a single-instance
  // deployment; a distributed deployment should move this to Redis.
  private readonly attempts = new Map<string, LoginAttemptRecord>();

  constructor(private readonly prisma: PrismaService) {}

  async hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  private assertNotRateLimited(key: string) {
    const now = Date.now();
    const record = this.attempts.get(key);
    if (!record || now - record.windowStart > LOGIN_WINDOW_MS) {
      this.attempts.set(key, { count: 1, windowStart: now });
      return;
    }
    if (record.count >= MAX_LOGIN_ATTEMPTS) {
      throw new UnauthorizedException(
        "Too many login attempts. Try again later.",
      );
    }
    record.count += 1;
  }

  private clearAttempts(key: string) {
    this.attempts.delete(key);
  }

  async login(
    email: string,
    password: string,
    context: { userAgent?: string; ipAddress?: string },
  ) {
    const key = email.toLowerCase();
    this.assertNotRateLimited(key);

    const employee = await this.prisma.employee.findFirst({
      where: { email: key },
    });

    // Constant-shape response: verify against a dummy hash when the
    // employee doesn't exist, so login timing doesn't reveal enumeration.
    const hashToVerify =
      employee?.passwordHash ??
      "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQAAAAAAAAAAA$invalidinvalidinvalidinvalidinvalidinva";

    const valid = await argon2.verify(hashToVerify, password).catch(() => false);

    if (!employee || !valid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    if (employee.employmentStatus !== EmploymentStatus.ACTIVE) {
      throw new UnauthorizedException("Account is not active");
    }

    this.clearAttempts(key);

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    await this.prisma.session.create({
      data: {
        employeeId: employee.id,
        tokenHash,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        userAgent: context.userAgent?.slice(0, 255),
        ipAddress: context.ipAddress,
      },
    });

    return {
      rawToken,
      expiresInMs: SESSION_TTL_MS,
      employee: {
        id: employee.id,
        organizationId: employee.organizationId,
        fullName: employee.fullName,
        email: employee.email,
        role: employee.role,
        mustChangePassword: employee.mustChangePassword,
      },
    };
  }

  async logout(sessionId: string) {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(
    employeeId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
    });

    const valid = await argon2.verify(employee.passwordHash, currentPassword);
    if (!valid) {
      throw new UnauthorizedException("Current password is incorrect");
    }

    const newHash = await this.hashPassword(newPassword);
    await this.prisma.employee.update({
      where: { id: employeeId },
      data: { passwordHash: newHash, mustChangePassword: false },
    });

    // Revoke all other sessions so a compromised session can't survive a
    // deliberate password change.
    await this.prisma.session.updateMany({
      where: { employeeId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
