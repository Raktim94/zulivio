import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { SCOPES } from "./events";

export const CREDENTIAL_PREFIX = "zlk_";
export const hashCredential = (raw: string) => createHash("sha256").update(raw).digest("hex");

@Injectable()
export class CredentialsService {
  constructor(private readonly prisma: PrismaService) {}

  private audit(actor: AuthenticatedEmployee, action: string, id: string, metadata: Record<string, string | number | string[] | null> = {}) {
    return this.prisma.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action, targetType: "IntegrationCredential", targetId: id, metadata } });
  }

  private view(c: { id: string; name: string; lastFour: string; scopes: string[]; expiresAt: Date | null; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date; createdById: string }, ownerName?: string) {
    const expired = c.expiresAt !== null && c.expiresAt.getTime() < Date.now();
    return {
      id: c.id, name: c.name, preview: `${CREDENTIAL_PREFIX}••••${c.lastFour}`, scopes: c.scopes, owner: ownerName ?? null, ownerId: c.createdById,
      createdAt: c.createdAt, expiresAt: c.expiresAt, lastUsedAt: c.lastUsedAt, revokedAt: c.revokedAt,
      status: c.revokedAt ? "revoked" : expired ? "expired" : "active",
    };
  }

  async list(actor: AuthenticatedEmployee) {
    const rows = await this.prisma.integrationCredential.findMany({ where: { organizationId: actor.organizationId }, orderBy: { createdAt: "desc" } });
    const owners = await this.prisma.employee.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, fullName: true } });
    const byId = new Map(owners.map((o) => [o.id, o.fullName]));
    return rows.map((r) => this.view(r, byId.get(r.createdById)));
  }

  async create(actor: AuthenticatedEmployee, dto: { name: string; scopes: string[]; expiresInDays?: number }) {
    const scopes = [...new Set(dto.scopes)];
    if (scopes.length === 0) throw new BadRequestException("Choose at least one scope. Credentials have no access by default.");
    const unknown = scopes.filter((s) => !(s in SCOPES));
    if (unknown.length) throw new BadRequestException(`Unknown scope: ${unknown.join(", ")}`);
    const raw = CREDENTIAL_PREFIX + randomBytes(32).toString("base64url");
    const days = dto.expiresInDays ?? 90;
    const row = await this.prisma.integrationCredential.create({
      data: {
        organizationId: actor.organizationId, name: dto.name.trim(), createdById: actor.id, tokenHash: hashCredential(raw), lastFour: raw.slice(-4), scopes,
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });
    await this.audit(actor, "integration_credential.created", row.id, { name: row.name, scopes, expiresInDays: days });
    // The only time the secret is ever returned.
    return { ...this.view(row, actor.fullName), secret: raw };
  }

  private async load(actor: AuthenticatedEmployee, id: string) {
    // 404 (not 403) for another organization's id: don't confirm it exists.
    const row = await this.prisma.integrationCredential.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!row) throw new NotFoundException("Credential not found");
    return row;
  }

  /** Immediate: the old secret stops working in the same request; there is no grace window. */
  async rotate(actor: AuthenticatedEmployee, id: string) {
    const row = await this.load(actor, id);
    if (row.revokedAt) throw new BadRequestException("A revoked credential can't be rotated. Create a new one.");
    const raw = CREDENTIAL_PREFIX + randomBytes(32).toString("base64url");
    const updated = await this.prisma.integrationCredential.update({ where: { id }, data: { tokenHash: hashCredential(raw), lastFour: raw.slice(-4) } });
    await this.audit(actor, "integration_credential.rotated", id, { name: row.name });
    return { ...this.view(updated), secret: raw };
  }

  async revoke(actor: AuthenticatedEmployee, id: string) {
    const row = await this.load(actor, id);
    if (!row.revokedAt) {
      await this.prisma.integrationCredential.update({ where: { id }, data: { revokedAt: new Date(), revokedById: actor.id } });
      await this.audit(actor, "integration_credential.revoked", id, { name: row.name });
    }
    return { ok: true };
  }
}
