import {
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { EmploymentStatus } from "@prisma/client";
import { InMemoryRateLimiter } from "../common/rate-limiter";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h, matches attendance shift assumptions
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// Explicit params rather than library defaults, so a future argon2 upgrade
// can't silently change hashing cost. m=19456 KiB (~19 MiB), t=2, p=1 is
// OWASP's "second choice" Argon2id preset — sized for modest self-hosted
// hardware (CasaOS/home NAS boxes) rather than a beefy server fleet.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class AuthService {
  private readonly loginLimiter = new InMemoryRateLimiter(
    MAX_LOGIN_ATTEMPTS,
    LOGIN_WINDOW_MS,
    "Too many login attempts. Try again later.",
  );
  private readonly changePasswordLimiter = new InMemoryRateLimiter(
    MAX_LOGIN_ATTEMPTS,
    LOGIN_WINDOW_MS,
    "Too many password-change attempts. Try again later.",
  );

  // Lazily computed hash of a random, never-reused secret, used to give a
  // "no such employee" login the exact same argon2 cost as a real verify —
  // computed via hashPassword() itself (not a hardcoded string) so it can
  // never drift out of sync with ARGON2_OPTIONS if those params change.
  private dummyHashPromise: Promise<string> | undefined;

  constructor(private readonly prisma: PrismaService) {}

  async hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  private getDummyHash(): Promise<string> {
    this.dummyHashPromise ??= this.hashPassword(randomBytes(32).toString("hex"));
    return this.dummyHashPromise;
  }

  async login(
    email: string,
    password: string,
    context: { userAgent?: string; ipAddress?: string },
  ) {
    const key = email.toLowerCase();
    this.loginLimiter.assert(key);

    const employee = await this.prisma.employee.findFirst({
      where: { email: key },
    });

    // Constant-shape response: verify against a dummy hash (same argon2
    // cost as a real one) when the employee doesn't exist, so login timing
    // doesn't reveal enumeration.
    const hashToVerify = employee?.passwordHash ?? (await this.getDummyHash());

    const valid = await argon2.verify(hashToVerify, password).catch(() => false);

    if (!employee || !valid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    if (employee.employmentStatus !== EmploymentStatus.ACTIVE) {
      throw new UnauthorizedException("Account is not active");
    }

    this.loginLimiter.clear(key);

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
    this.changePasswordLimiter.assert(employeeId);

    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
    });

    const valid = await argon2.verify(employee.passwordHash, currentPassword);
    if (!valid) {
      throw new UnauthorizedException("Current password is incorrect");
    }
    this.changePasswordLimiter.clear(employeeId);

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
