import { BadRequestException, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { WebhookDeliveryStatus, WebhookStatus, type Prisma, type WebhookEndpoint } from "@prisma/client";
import { FieldEncryptionService } from "../common/crypto/field-encryption.service";
import { PrismaService } from "../prisma/prisma.service";
import { API_VERSION, TEST_EVENT } from "./events";
import { parseWebhookUrl, safeLookup } from "./url-safety";

/** Delay before retry n (1-based). After the last entry the delivery is marked FAILED. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000, 12 * 3600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** A run of this many permanently failed deliveries pauses the endpoint so a dead receiver isn't hammered forever. */
export const AUTO_PAUSE_AFTER = 10;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_PAYLOAD_BYTES = 256 * 1024;

export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

@Injectable()
export class WebhookDispatcher implements OnApplicationShutdown {
  private readonly logger = new Logger(WebhookDispatcher.name);
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldEncryptionService,
  ) {}

  /**
   * Queue an event for every active endpoint of the organization that
   * subscribed to it. Never throws: a webhook problem must not fail the
   * business operation that triggered it.
   */
  emit(organizationId: string, type: string, data: Record<string, unknown>): Promise<void> {
    const p = this.doEmit(organizationId, type, data);
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
    return p;
  }

  async onApplicationShutdown() {
    await this.flush();
  }

  /** Resolves when every event queued so far has been written. Used on shutdown and by tests. */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
  }

  private async doEmit(organizationId: string, type: string, data: Record<string, unknown>): Promise<void> {
    try {
      const endpoints = await this.prisma.webhookEndpoint.findMany({
        where: { organizationId, status: WebhookStatus.ACTIVE, OR: [{ events: { has: type } }, { events: { has: "*" } }] },
        select: { id: true },
      });
      if (endpoints.length === 0) return;
      const eventId = `evt_${randomUUID()}`;
      const payload = { id: eventId, type, apiVersion: API_VERSION, createdAt: new Date().toISOString(), organizationId, data };
      await this.prisma.webhookDelivery.createMany({
        data: endpoints.map((e) => ({ endpointId: e.id, organizationId, eventId, eventType: type, payload: payload as unknown as Prisma.InputJsonValue })),
        skipDuplicates: true,
      });
    } catch (err) {
      this.logger.warn(`emit(${type}) failed: ${(err as Error).name}`);
    }
  }

  /** Sends a signed `webhook.test` immediately and returns the stored delivery. */
  async sendTest(endpoint: WebhookEndpoint) {
    const eventId = `evt_${randomUUID()}`;
    const payload = { id: eventId, type: TEST_EVENT, apiVersion: API_VERSION, createdAt: new Date().toISOString(), organizationId: endpoint.organizationId, data: { message: "This is a test delivery from Zulivio." } };
    const delivery = await this.prisma.webhookDelivery.create({
      data: { endpointId: endpoint.id, organizationId: endpoint.organizationId, eventId, eventType: TEST_EVENT, payload: payload, isTest: true, nextAttemptAt: new Date(Date.now() + 120_000) },
    });
    await this.attempt(delivery.id, endpoint, true);
    return this.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  }

  /** Picks up due deliveries. Public so tests (and an operator) can run a pass on demand. */
  @Interval(5_000)
  async processDue(): Promise<number> {
    let sent = 0;
    try {
      const now = new Date();
      const due = await this.prisma.webhookDelivery.findMany({
        where: { status: WebhookDeliveryStatus.PENDING, nextAttemptAt: { lte: now }, endpoint: { status: WebhookStatus.ACTIVE } },
        orderBy: { nextAttemptAt: "asc" },
        take: 25,
        include: { endpoint: true },
      });
      for (const d of due) {
        // Lease: push nextAttemptAt out so an overlapping pass can't send the same delivery twice.
        const claimed = await this.prisma.webhookDelivery.updateMany({
          where: { id: d.id, status: WebhookDeliveryStatus.PENDING, nextAttemptAt: d.nextAttemptAt },
          data: { nextAttemptAt: new Date(Date.now() + 120_000) },
        });
        if (claimed.count !== 1) continue;
        await this.attempt(d.id, d.endpoint, false);
        sent++;
      }
    } catch (err) {
      this.logger.error(`processDue failed: ${(err as Error).name}`);
    }
    return sent;
  }

  private async attempt(deliveryId: string, endpoint: WebhookEndpoint, isTest: boolean) {
    const delivery = await this.prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) return;
    const attempts = delivery.attempts + 1;
    const now = new Date();
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const body = JSON.stringify(delivery.payload);
      if (Buffer.byteLength(body) > MAX_PAYLOAD_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
      // Re-validate at send time: covers IP-literal hosts (Node never calls `lookup` for those) and an operator
      // who withdrew the private-network opt-in after the endpoint was registered. Names are checked by safeLookup.
      parseWebhookUrl(endpoint.url);
      const secret = this.crypto.decrypt(endpoint.secretEnc);
      statusCode = await this.post(endpoint.url, body, secret, delivery.eventId, delivery.eventType, attempts);
      if (statusCode < 200 || statusCode >= 300) error = `HTTP ${statusCode}`;
    } catch (e) {
      const msg = (e as Error).message ?? "";
      error =
        e instanceof BadRequestException ? `Blocked: ${msg}`
        : msg === "BLOCKED_ADDRESS" ? "Blocked: the address resolves to a private network"
        : msg === "TIMEOUT" ? "Timed out"
        : (e as NodeJS.ErrnoException).code ?? "Connection failed";
    }

    if (!error) {
      await this.prisma.$transaction([
        this.prisma.webhookDelivery.update({ where: { id: deliveryId }, data: { status: WebhookDeliveryStatus.SUCCESS, attempts, lastAttemptAt: now, lastStatusCode: statusCode, lastError: null, deliveredAt: now } }),
        this.prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { consecutiveFailures: 0, lastDeliveryAt: now, lastSuccessAt: now } }),
      ]);
      return;
    }

    const exhausted = isTest || attempts >= MAX_ATTEMPTS;
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: exhausted ? WebhookDeliveryStatus.FAILED : WebhookDeliveryStatus.PENDING,
        attempts, lastAttemptAt: now, lastStatusCode: statusCode, lastError: error,
        nextAttemptAt: exhausted ? now : new Date(now.getTime() + RETRY_DELAYS_MS[attempts - 1]),
      },
    });
    await this.prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { lastDeliveryAt: now } });
    if (exhausted && !isTest) {
      const updated = await this.prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { consecutiveFailures: { increment: 1 } } });
      if (updated.consecutiveFailures >= AUTO_PAUSE_AFTER && updated.status === WebhookStatus.ACTIVE) {
        await this.prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { status: WebhookStatus.PAUSED } });
        await this.prisma.auditEvent.create({
          data: { organizationId: endpoint.organizationId, action: "webhook.auto_paused", targetType: "WebhookEndpoint", targetId: endpoint.id, metadata: { consecutiveFailures: updated.consecutiveFailures } },
        }).catch(() => undefined);
      }
    }
  }

  /** Raw HTTP so the connection goes through safeLookup and redirects are never followed. */
  private post(rawUrl: string, body: string, secret: string, eventId: string, eventType: string, attempt: number): Promise<number> {
    const url = new URL(rawUrl);
    const ts = Math.floor(Date.now() / 1000);
    const lib = url.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.request(
        url,
        {
          method: "POST",
          lookup: safeLookup,
          timeout: REQUEST_TIMEOUT_MS,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            "User-Agent": "Zulivio-Webhooks/1",
            "X-Zulivio-Event-Id": eventId,
            "X-Zulivio-Event-Type": eventType,
            "X-Zulivio-Delivery-Attempt": String(attempt),
            "X-Zulivio-Timestamp": String(ts),
            "X-Zulivio-Signature": `t=${ts},v1=${signPayload(secret, ts, body)}`,
          },
        },
        (res) => {
          res.resume(); // the response body is never read or stored
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("timeout", () => req.destroy(new Error("TIMEOUT")));
      req.on("error", reject);
      req.end(body);
    });
  }
}
