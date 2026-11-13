import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseFilters, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../common/decorators/public.decorator";
import { phoneLast10 } from "../common/phone.util";
import { LeadsService } from "../leads/leads.service";
import { MobileApiExceptionFilter, mobileError } from "../mobile-calls/mobile-api-error.filter";
import { normalizeCallNumber } from "../mobile-calls/mobile-phone.util";
import { PrismaService } from "../prisma/prisma.service";
import { ExtCallDto, ExtCreateLeadDto, ExtListQuery } from "./dto";
import { leadPayload } from "./events";
import { IntegrationAuthGuard, RequireScope } from "./integration-auth.guard";
import { TelephonyService } from "./telephony.service";
import { WebhookDispatcher } from "./webhook-dispatcher.service";

const MAX_EVENT_BYTES = 256 * 1024;

/** Called by a customer's phone system. Authentication is the signature, not a session. */
@Public()
@UseFilters(MobileApiExceptionFilter)
@Controller("api/v1/integrations/telephony")
export class TelephonyReceiverController {
  constructor(private readonly telephony: TelephonyService) {}

  @Post(":id/events")
  @HttpCode(HttpStatus.OK)
  receive(@Param("id") id: string, @Body() body: unknown, @Req() req: Request) {
    if (Number(req.headers["content-length"] ?? 0) > MAX_EVENT_BYTES) throw mobileError(HttpStatus.PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE", "Event is too large.");
    return this.telephony.receive(id, req.rawBody, body, req.headers, req.ip ?? "unknown");
  }
}

function encodeCursor(d: Date, id: string) { return Buffer.from(`${d.toISOString()}|${id}`).toString("base64url"); }
function decodeCursor(c: string | undefined): { at: Date; id: string } | null {
  if (!c) return null;
  try {
    const [at, id] = Buffer.from(c, "base64url").toString().split("|");
    const d = new Date(at);
    return Number.isNaN(d.getTime()) || !id ? null : { at: d, id };
  } catch { return null; }
}

/**
 * Versioned machine API. Authenticated by IntegrationCredential (zlk_), scoped per route,
 * organization-bound by the credential itself (nothing in a request can name another organization).
 */
@Public()
@UseFilters(MobileApiExceptionFilter)
@UseGuards(IntegrationAuthGuard)
@Controller("api/v1/ext")
export class ExtController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly telephony: TelephonyService,
    private readonly hooks: WebhookDispatcher,
  ) {}

  /** Incremental sync: ordered by (updatedAt, id) so `cursor` never skips or repeats a row, even while data changes. */
  @Get("leads")
  @RequireScope("leads:read")
  async listLeads(@Req() req: Request, @Query() q: ExtListQuery) {
    const org = req.integrationCredential!.organizationId;
    const limit = q.limit ?? 25;
    const c = decodeCursor(q.cursor);
    if (q.cursor && !c) throw mobileError(HttpStatus.BAD_REQUEST, "INVALID_CURSOR", "cursor is not valid.");
    const since = q.updatedSince ? new Date(q.updatedSince) : null;
    if (since && Number.isNaN(since.getTime())) throw mobileError(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "updatedSince must be an ISO 8601 timestamp.");
    const rows = await this.prisma.lead.findMany({
      where: {
        organizationId: org,
        ...(since ? { updatedAt: { gte: since } } : {}),
        ...(c ? { OR: [{ updatedAt: { gt: c.at } }, { updatedAt: c.at, id: { gt: c.id } }] } : {}),
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return { data: page.map(leadPayload), nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].updatedAt, page[page.length - 1].id) : null };
  }

  @Get("leads/:id")
  @RequireScope("leads:read")
  async getLead(@Req() req: Request, @Param("id") id: string) {
    const lead = /^[0-9a-f-]{36}$/i.test(id) ? await this.prisma.lead.findFirst({ where: { id, organizationId: req.integrationCredential!.organizationId } }) : null;
    if (!lead) throw mobileError(HttpStatus.NOT_FOUND, "NOT_FOUND", "Lead not found.");
    return leadPayload(lead);
  }

  /** Supports `Idempotency-Key`: retrying the same request returns the original lead instead of creating another. */
  @Post("leads")
  @RequireScope("leads:write")
  async createLead(@Req() req: Request, @Body() dto: ExtCreateLeadDto) {
    const cred = req.integrationCredential!;
    const creator = await this.prisma.employee.findUniqueOrThrow({ where: { id: cred.createdById } });
    if (dto.phone) {
      const n = normalizeCallNumber(dto.phone);
      if (!n) throw mobileError(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_PHONE_NUMBER", "phone is not a valid phone number.");
      if (n.last10.length === 10) {
        const dup = await this.prisma.lead.findMany({ where: { organizationId: cred.organizationId, phone: { endsWith: n.last10 } }, select: { id: true, phone: true }, take: 5 });
        const hit = dup.find((l) => phoneLast10(l.phone) === n.last10);
        if (hit) throw mobileError(HttpStatus.CONFLICT, "DUPLICATE_LEAD", `A lead with this phone number already exists (${hit.id}).`);
      }
    }
    const lead = await this.leads.create(
      { id: creator.id, organizationId: creator.organizationId, role: creator.role, fullName: creator.fullName, email: creator.email, employmentStatus: creator.employmentStatus, mustChangePassword: false },
      { fullName: dto.fullName, phone: dto.phone, email: dto.email, company: dto.company, notes: dto.notes, tags: dto.tags, source: dto.source ?? `api:${cred.name}`.slice(0, 100) },
    );
    await this.prisma.auditEvent.create({ data: { organizationId: cred.organizationId, actorId: creator.id, action: "ext.lead_created", targetType: "Lead", targetId: lead.id, metadata: { credentialId: cred.id } } });
    return leadPayload(lead);
  }

  @Post("calls")
  @RequireScope("calls:write")
  async recordCall(@Req() req: Request, @Body() dto: ExtCallDto) {
    const cred = req.integrationCredential!;
    const n = normalizeCallNumber(dto.phone_number);
    if (!n) throw mobileError(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_PHONE_NUMBER", "phone_number is not valid.");
    const d = (v?: string) => { const t = v ? new Date(v) : null; if (t && Number.isNaN(t.getTime())) throw mobileError(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_TIMESTAMP", "Timestamps must be ISO 8601."); return t; };
    const r = await this.telephony.ingest(cred.organizationId, `ext:${cred.id}`, null, cred.name, cred.createdById, {
      providerCallId: dto.provider_call_id, eventType: dto.event_type, direction: dto.direction, phone: dto.phone_number,
      startedAt: d(dto.started_at), answeredAt: null, endedAt: d(dto.ended_at), durationSeconds: dto.duration_seconds ?? null, agentEmail: dto.agent_email?.toLowerCase() ?? null,
    });
    return { success: true, duplicate: r.duplicate, id: r.id };
  }

  @Get("calls")
  @RequireScope("calls:read")
  async listCalls(@Req() req: Request, @Query() q: ExtListQuery) {
    const org = req.integrationCredential!.organizationId;
    const limit = q.limit ?? 25;
    const c = decodeCursor(q.cursor);
    if (q.cursor && !c) throw mobileError(HttpStatus.BAD_REQUEST, "INVALID_CURSOR", "cursor is not valid.");
    const rows = await this.prisma.providerCallEvent.findMany({
      where: { organizationId: org, ...(c ? { OR: [{ receivedAt: { gt: c.at } }, { receivedAt: c.at, id: { gt: c.id } }] } : {}) },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }], take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      data: page.map((r) => ({ id: r.id, providerCallId: r.providerCallId, eventType: r.eventType, direction: r.direction, phone: r.phoneNormalized, durationSeconds: r.durationSeconds, startedAt: r.startedAt, endedAt: r.endedAt, leadId: r.leadId, receivedAt: r.receivedAt })),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].receivedAt, page[page.length - 1].id) : null,
    };
  }
}
