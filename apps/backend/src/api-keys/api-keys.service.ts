import { randomBytes, createHash } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { EmploymentStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";
import { IssueApiKeyDto } from "./dto/issue-api-key.dto";

const TOKEN_PREFIX = "zlv_";
const MAX_ACTIVE_KEYS_PER_EMPLOYEE = 10;

/**
 * Personal access tokens an employee generates for themselves (Settings >
 * API Keys) — primarily so an MCP client (Claude, ChatGPT, etc., see
 * mcp/) can call the API as that employee. Same tokenHash-lookup pattern
 * as Session (see ApiKey in schema.prisma): the raw token is shown exactly
 * once at creation and never persisted or retrievable again.
 */
@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  private generateToken(): { raw: string; hash: string; lastFour: string } {
    const raw = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
    return {
      raw,
      hash: createHash("sha256").update(raw).digest("hex"),
      lastFour: raw.slice(-4),
    };
  }

  async create(actor: AuthenticatedEmployee, dto: CreateApiKeyDto) {
    return this.issueKey(actor.id, dto.name, null);
  }

  /**
   * MASTER_OWNER provisions a key on behalf of another employee — e.g. a
   * per-device token for the MacroDroid missed-call integration (see
   * missed-calls/), so a company phone can authenticate as the employee it
   * belongs to without that employee ever visiting Settings > API Keys
   * themselves. Functionally identical to a self-service key once created
   * (AuthGuard resolves it to employeeId exactly the same way); issuedById
   * just records who handed it out, for GET /org and revocation.
   */
  async issueFor(actor: AuthenticatedEmployee, dto: IssueApiKeyDto) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, organizationId: actor.organizationId },
    });
    if (!employee) {
      throw new NotFoundException("Employee not found in this organization");
    }
    if (employee.employmentStatus !== EmploymentStatus.ACTIVE) {
      throw new BadRequestException("Cannot issue a key to an employee who is not active");
    }

    return this.issueKey(employee.id, dto.name, actor.id);
  }

  private async issueKey(employeeId: string, name: string, issuedById: string | null) {
    const activeCount = await this.prisma.apiKey.count({
      where: { employeeId, revokedAt: null },
    });
    if (activeCount >= MAX_ACTIVE_KEYS_PER_EMPLOYEE) {
      throw new BadRequestException(
        `This employee already has ${MAX_ACTIVE_KEYS_PER_EMPLOYEE} active API keys — revoke one before creating another.`,
      );
    }

    const { raw, hash, lastFour } = this.generateToken();
    const key = await this.prisma.apiKey.create({
      data: { employeeId, issuedById, name, tokenHash: hash, lastFour },
    });

    // The only point in this key's lifetime the raw token is ever
    // available — every other read returns the masked summary below.
    return {
      id: key.id,
      name: key.name,
      token: raw,
      lastFour: key.lastFour,
      createdAt: key.createdAt,
    };
  }

  /** Org-wide view for MASTER_OWNER — e.g. the Settings page listing every device/integration token in flight. */
  async listForOrg(actor: AuthenticatedEmployee) {
    const keys = await this.prisma.apiKey.findMany({
      where: { employee: { organizationId: actor.organizationId } },
      orderBy: { createdAt: "desc" },
      include: {
        employee: { select: { id: true, fullName: true, employeeNumber: true } },
        issuedBy: { select: { id: true, fullName: true } },
      },
    });
    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      lastFour: key.lastFour,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
      employee: key.employee,
      issuedBy: key.issuedBy,
    }));
  }

  /** MASTER_OWNER revoking any key in their org — e.g. a lost phone or an employee who left. */
  async revokeForOrg(actor: AuthenticatedEmployee, id: string) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, employee: { organizationId: actor.organizationId } },
    });
    if (!key) throw new NotFoundException("API key not found");
    if (!key.revokedAt) {
      await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    }
    return { ok: true };
  }

  async list(actor: AuthenticatedEmployee) {
    const keys = await this.prisma.apiKey.findMany({
      where: { employeeId: actor.id },
      orderBy: { createdAt: "desc" },
    });
    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      lastFour: key.lastFour,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
    }));
  }

  async revoke(actor: AuthenticatedEmployee, id: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException("API key not found");
    if (key.employeeId !== actor.id) {
      throw new ForbiddenException("You can only revoke your own API keys");
    }
    if (!key.revokedAt) {
      await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    }
    return { ok: true };
  }
}
