import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { WebhookDeliveryStatus, WebhookStatus } from "@prisma/client";
import { FieldEncryptionService } from "../common/crypto/field-encryption.service";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { EVENT_TYPES } from "./events";
import { assertSafeWebhookUrl } from "./url-safety";
import { WebhookDispatcher } from "./webhook-dispatcher.service";

const MAX_ENDPOINTS = 20;
export const newWebhookSecret = () => "whsec_" + randomBytes(32).toString("base64url");

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldEncryptionService,
    private readonly dispatcher: WebhookDispatcher,
  ) {}

  private audit(actor: AuthenticatedEmployee, action: string, id: string, metadata: Record<string, string | number | string[] | null> = {}) {
    return this.prisma.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action, targetType: "WebhookEndpoint", targetId: id, metadata } });
  }

  private view(e: { id: string; name: string; url: string; events: string[]; status: WebhookStatus; secretLastFour: string; secretRotatedAt: Date; consecutiveFailures: number; lastDeliveryAt: Date | null; lastSuccessAt: Date | null; createdAt: Date }) {
    return {
      id: e.id, name: e.name, url: e.url, events: e.events, status: e.status.toLowerCase(), secretPreview: `whsec_••••${e.secretLastFour}`, secretRotatedAt: e.secretRotatedAt,
      consecutiveFailures: e.consecutiveFailures, lastDeliveryAt: e.lastDeliveryAt, lastSuccessAt: e.lastSuccessAt, createdAt: e.createdAt,
    };
  }

  private checkEvents(events: string[]) {
    const clean = [...new Set(events)];
    if (clean.length === 0) throw new BadRequestException("Choose at least one event.");
    const bad = clean.filter((e) => e !== "*" && !(e in EVENT_TYPES));
    if (bad.length) throw new BadRequestException(`Unknown event type: ${bad.join(", ")}`);
    return clean;
  }

  private async load(actor: AuthenticatedEmployee, id: string) {
    const row = await this.prisma.webhookEndpoint.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!row || row.status === WebhookStatus.REVOKED) throw new NotFoundException("Webhook not found");
    return row;
  }

  async list(actor: AuthenticatedEmployee) {
    const rows = await this.prisma.webhookEndpoint.findMany({ where: { organizationId: actor.organizationId, status: { not: WebhookStatus.REVOKED } }, orderBy: { createdAt: "desc" } });
    return rows.map((r) => this.view(r));
  }

  async create(actor: AuthenticatedEmployee, dto: { name: string; url: string; events: string[] }) {
    const count = await this.prisma.webhookEndpoint.count({ where: { organizationId: actor.organizationId, status: { not: WebhookStatus.REVOKED } } });
    if (count >= MAX_ENDPOINTS) throw new BadRequestException(`An organization can have at most ${MAX_ENDPOINTS} webhooks.`);
    const url = await assertSafeWebhookUrl(dto.url);
    const events = this.checkEvents(dto.events);
    const secret = newWebhookSecret();
    const row = await this.prisma.webhookEndpoint.create({
      data: { organizationId: actor.organizationId, name: dto.name.trim(), url: url.toString(), events, secretEnc: this.crypto.encrypt(secret), secretLastFour: secret.slice(-4), createdById: actor.id },
    });
    await this.audit(actor, "webhook.created", row.id, { name: row.name, url: row.url, events });
    return { ...this.view(row), secret }; // shown once
  }

  async update(actor: AuthenticatedEmployee, id: string, dto: { name?: string; url?: string; events?: string[]; status?: "active" | "paused" }) {
    const row = await this.load(actor, id);
    const data: { name?: string; url?: string; events?: string[]; status?: WebhookStatus; consecutiveFailures?: number } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.url !== undefined) data.url = (await assertSafeWebhookUrl(dto.url)).toString();
    if (dto.events !== undefined) data.events = this.checkEvents(dto.events);
    if (dto.status) {
      data.status = dto.status === "paused" ? WebhookStatus.PAUSED : WebhookStatus.ACTIVE;
      if (dto.status === "active") data.consecutiveFailures = 0;
    }
    const updated = await this.prisma.webhookEndpoint.update({ where: { id }, data });
    await this.audit(actor, dto.status === "paused" ? "webhook.paused" : dto.status === "active" ? "webhook.resumed" : "webhook.updated", id, { name: updated.name, url: updated.url, events: updated.events });
    void row;
    return this.view(updated);
  }

  /** Takes effect immediately: the next signature is made with the new secret and the old one verifies nothing. */
  async rotateSecret(actor: AuthenticatedEmployee, id: string) {
    await this.load(actor, id);
    const secret = newWebhookSecret();
    const updated = await this.prisma.webhookEndpoint.update({ where: { id }, data: { secretEnc: this.crypto.encrypt(secret), secretLastFour: secret.slice(-4), secretRotatedAt: new Date() } });
    await this.audit(actor, "webhook.secret_rotated", id, { name: updated.name });
    return { ...this.view(updated), secret };
  }

  async revoke(actor: AuthenticatedEmployee, id: string) {
    const row = await this.load(actor, id);
    await this.prisma.$transaction([
      this.prisma.webhookEndpoint.update({ where: { id }, data: { status: WebhookStatus.REVOKED } }),
      this.prisma.webhookDelivery.updateMany({ where: { endpointId: id, status: WebhookDeliveryStatus.PENDING }, data: { status: WebhookDeliveryStatus.FAILED, lastError: "Endpoint revoked" } }),
    ]);
    await this.audit(actor, "webhook.revoked", id, { name: row.name });
    return { ok: true };
  }

  async test(actor: AuthenticatedEmployee, id: string) {
    const row = await this.load(actor, id);
    const delivery = await this.dispatcher.sendTest(row);
    await this.audit(actor, "webhook.test_sent", id, { status: delivery.status });
    return this.deliveryView(delivery);
  }

  private deliveryView(d: { id: string; eventId: string; eventType: string; status: WebhookDeliveryStatus; attempts: number; lastStatusCode: number | null; lastError: string | null; lastAttemptAt: Date | null; nextAttemptAt: Date; deliveredAt: Date | null; isTest: boolean; createdAt: Date }) {
    return {
      id: d.id, eventId: d.eventId, eventType: d.eventType, status: d.status.toLowerCase(), attempts: d.attempts, statusCode: d.lastStatusCode, error: d.lastError,
      lastAttemptAt: d.lastAttemptAt, nextAttemptAt: d.status === WebhookDeliveryStatus.PENDING ? d.nextAttemptAt : null, deliveredAt: d.deliveredAt, isTest: d.isTest, createdAt: d.createdAt,
    };
  }

  async deliveries(actor: AuthenticatedEmployee, id: string, cursor: string | undefined, limit: number) {
    await this.load(actor, id);
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { endpointId: id, organizationId: actor.organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return { data: page.map((d) => this.deliveryView(d)), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  async retry(actor: AuthenticatedEmployee, deliveryId: string) {
    const d = await this.prisma.webhookDelivery.findFirst({ where: { id: deliveryId, organizationId: actor.organizationId }, include: { endpoint: true } });
    if (!d || d.endpoint.status === WebhookStatus.REVOKED) throw new NotFoundException("Delivery not found");
    if (d.status === WebhookDeliveryStatus.SUCCESS) throw new BadRequestException("That delivery already succeeded.");
    await this.prisma.webhookDelivery.update({ where: { id: deliveryId }, data: { status: WebhookDeliveryStatus.PENDING, attempts: 0, nextAttemptAt: new Date(), lastError: null } });
    await this.audit(actor, "webhook.delivery_retried", d.endpointId, { deliveryId });
    return { ok: true };
  }
}
