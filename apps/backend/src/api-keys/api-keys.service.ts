import { randomBytes, createHash } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";

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
    const activeCount = await this.prisma.apiKey.count({
      where: { employeeId: actor.id, revokedAt: null },
    });
    if (activeCount >= MAX_ACTIVE_KEYS_PER_EMPLOYEE) {
      throw new BadRequestException(
        `You already have ${MAX_ACTIVE_KEYS_PER_EMPLOYEE} active API keys — revoke one before creating another.`,
      );
    }

    const { raw, hash, lastFour } = this.generateToken();
    const key = await this.prisma.apiKey.create({
      data: { employeeId: actor.id, name: dto.name, tokenHash: hash, lastFour },
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
