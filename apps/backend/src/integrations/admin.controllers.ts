import { Body, CanActivate, Controller, Delete, ExecutionContext, ForbiddenException, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import type { Request } from "express";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { AuthGuard, type AuthenticatedEmployee } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PrismaService } from "../prisma/prisma.service";
import { CredentialsService } from "./credentials.service";
import { CreateCredentialDto, CreateProviderDto, CreateWebhookDto, PageQuery, TestProviderDto, UpdateProviderDto, UpdateWebhookDto } from "./dto";
import { EVENT_TYPES, SCOPES, API_VERSION } from "./events";
import { TelephonyService, DEFAULT_FIELDS, DEFAULT_STATUS_MAP } from "./telephony.service";
import { WebhooksService } from "./webhooks.service";

/**
 * Integration administration needs a real signed-in person. A personal API key (MCP) or a phone's token resolves to an
 * employee too, but must never be able to mint credentials or re-point webhooks.
 */
@Injectable()
export class HumanSessionOnly implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.apiKeyId || req.mobileAuth) throw new ForbiddenException("Integration settings can only be changed from a signed-in browser session.");
    return true;
  }
}

const ADMIN = [AuthGuard, HumanSessionOnly, RolesGuard] as const;

@UseGuards(...ADMIN)
@Roles(Role.COMPANY_ADMIN)
@Controller("api/v1/integrations")
export class IntegrationsAdminController {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly webhooks: WebhooksService,
    private readonly telephony: TelephonyService,
    private readonly prisma: PrismaService,
  ) {}

  /** What exists and what state it is in. Only connectors that are actually implemented are listed. */
  @Get("directory")
  async directory(@CurrentEmployee() actor: AuthenticatedEmployee) {
    const org = actor.organizationId;
    const [creds, hooks, providers, devices, sheets, personalKeys] = await Promise.all([
      this.prisma.integrationCredential.count({ where: { organizationId: org, revokedAt: null } }),
      this.prisma.webhookEndpoint.groupBy({ by: ["status"], where: { organizationId: org, status: { not: "REVOKED" } }, _count: true }),
      this.prisma.telephonyProvider.findMany({ where: { organizationId: org }, select: { enabled: true, lastEventAt: true } }),
      this.prisma.mobileDevice.count({ where: { organizationId: org, status: "ACTIVE" } }),
      this.prisma.googleSheetsConfig.findFirst(),
      this.prisma.apiKey.count({ where: { revokedAt: null, employee: { organizationId: org } } }),
    ]);
    const activeHooks = hooks.find((h) => h.status === "ACTIVE")?._count ?? 0;
    const pausedHooks = hooks.find((h) => h.status === "PAUSED")?._count ?? 0;
    return {
      apiVersion: API_VERSION,
      items: [
        { key: "api-clients", name: "API clients", description: "Organization-level credentials with explicit scopes for the /api/v1/ext API.", status: creds > 0 ? "connected" : "not_configured", detail: `${creds} active credential${creds === 1 ? "" : "s"}`, href: "/integrations" },
        { key: "webhooks", name: "Webhooks", description: "Signed event deliveries to your own HTTPS endpoints, with retries and history.", status: activeHooks > 0 ? "connected" : pausedHooks > 0 ? "paused" : "not_configured", detail: `${activeHooks} active, ${pausedHooks} paused`, href: "/integrations" },
        { key: "telephony", name: "Telephony providers", description: "Receive call events from a business phone system or PBX that can send signed webhooks.", status: providers.some((p) => p.enabled) ? (providers.some((p) => p.lastEventAt) ? "connected" : "waiting_for_events") : "not_configured", detail: `${providers.length} configured`, href: "/integrations" },
        { key: "mobile-devices", name: "Android devices", description: "Phones signed in to the Zulivio Android app, and static-token device ingest.", status: devices > 0 ? "connected" : "not_configured", detail: `${devices} active device${devices === 1 ? "" : "s"}`, href: "/calls" },
        { key: "google-sheets", name: "Google Sheets", description: "Import and export leads and deals.", status: sheets ? "connected" : "not_configured", detail: sheets ? "Configured in Data Hub" : "Set up in Data Hub", href: "/data-hub" },
        { key: "mcp", name: "MCP / personal API keys", description: "Personal tokens that act as one employee (separate from API clients above).", status: personalKeys > 0 ? "connected" : "not_configured", detail: `${personalKeys} active key${personalKeys === 1 ? "" : "s"}`, href: "/settings" },
      ],
    };
  }

  @Get("catalog")
  catalog() {
    return {
      apiVersion: API_VERSION,
      events: Object.entries(EVENT_TYPES).map(([type, description]) => ({ type, description })),
      scopes: Object.entries(SCOPES).map(([scope, description]) => ({ scope, description })),
      telephony: { kind: "GENERIC_WEBHOOK", defaultFields: DEFAULT_FIELDS, defaultStatusMap: DEFAULT_STATUS_MAP },
    };
  }

  // ---- credentials ----
  @Get("credentials") listCredentials(@CurrentEmployee() a: AuthenticatedEmployee) { return this.credentials.list(a); }
  @Post("credentials") createCredential(@CurrentEmployee() a: AuthenticatedEmployee, @Body() dto: CreateCredentialDto) { return this.credentials.create(a, dto); }
  @Post("credentials/:id/rotate") @HttpCode(200) rotateCredential(@CurrentEmployee() a: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string) { return this.credentials.rotate(a, id); }
  @Delete("credentials/:id") revokeCredential(@CurrentEmployee() a: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string) { return this.credentials.revoke(a, id); }

  // ---- webhooks ----
  @Get("webhooks") listWebhooks(@CurrentEmployee() a: AuthenticatedEmployee) { return this.webhooks.list(a); }
  @Post("webhooks") createWebhook(@CurrentEmployee() a: AuthenticatedEmployee, @Body() dto: CreateWebhookDto) { return this.webhooks.create(a, dto); }
  @Patch("webhooks/:id") updateWebhook(@CurrentEmployee() a: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateWebhookDto) { return this.webhooks.update(a, id, dto); }
  @Delete("webhooks/:id") revokeWebhook(@CurrentEmployee() a: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string) { return this.webhooks.revoke(a, id); }
  @Post("webhooks/:id/rotate-secret") @HttpCode(200) rotateWebhook(@CurrentEmployee() a: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string) { return this.webhooks.rotateSecret(a, id); }
  @Post("webhooks/:id/test") @HttpCode(200) testWebhook(@CurrentEmployee() a: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string) { return this.webhooks.test(a, id); }
  @Get("webhooks/:id/deliveries") deliveries(@CurrentEmployee() a: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string, @Query() q: PageQuery) { return this.webhooks.deliveries(a, id, q.cursor, q.limit ?? 25); }
  @Post("webhook-deliveries/:id/retry") @HttpCode(200) retryDelivery(@CurrentEmployee() a: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string) { return this.webhooks.retry(a, id); }

  // ---- telephony providers ----
  @Get("telephony") listProviders(@CurrentEmployee() a: AuthenticatedEmployee) { return this.telephony.list(a); }
  @Post("telephony") createProvider(@CurrentEmployee() a: AuthenticatedEmployee, @Body() dto: CreateProviderDto) { return this.telephony.create(a, dto); }
  @Patch("telephony/:id") updateProvider(@CurrentEmployee() a: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateProviderDto) { return this.telephony.update(a, id, dto); }
  @Delete("telephony/:id") removeProvider(@CurrentEmployee() a: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string) { return this.telephony.remove(a, id); }
  @Post("telephony/:id/rotate-secret") @HttpCode(200) rotateProvider(@CurrentEmployee() a: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string) { return this.telephony.rotateSecret(a, id); }
  @Post("telephony/:id/test") @HttpCode(200) testProvider(@CurrentEmployee() a: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string, @Body() dto: TestProviderDto) { return this.telephony.test(a, id, dto.payload); }
  @Get("telephony/:id/events") providerEvents(@CurrentEmployee() a: AuthenticatedEmployee, @Param("id", ParseUUIDPipe) id: string) { return this.telephony.events(a, id); }

}
