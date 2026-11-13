import { createHash, createHmac, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { Role } from "@prisma/client";
import * as argon2 from "argon2";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { createCsrfOriginCheck } from "../src/common/csrf-origin-check";
import { WebhookDispatcher, signPayload } from "../src/integrations/webhook-dispatcher.service";
import { PrismaService } from "../src/prisma/prisma.service";

const stamp = Date.now();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("Integrations & API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dispatcher: WebhookDispatcher;
  const server = () => app.getHttpServer();
  type Org = Awaited<ReturnType<typeof makeOrg>>;
  let a: Org;
  let b: Org;

  async function makeEmployee(organizationId: string, role: Role, label: string) {
    const emp = await prisma.employee.create({
      data: { organizationId, employeeNumber: `${label}-${stamp}`, fullName: `${label} person`, email: `${label}-${stamp}@int.local`.toLowerCase(), passwordHash: "unused", role, mustChangePassword: false },
    });
    const raw = randomBytes(24).toString("base64url");
    await prisma.session.create({ data: { employeeId: emp.id, tokenHash: sha(raw), expiresAt: new Date(Date.now() + 3_600_000) } });
    return { id: emp.id, cookie: `ndcrm_session=${raw}`, email: emp.email };
  }
  async function makeOrg(label: string) {
    const org = await prisma.organization.create({ data: { name: `${label} ${stamp}` } });
    return { id: org.id, admin: await makeEmployee(org.id, Role.COMPANY_ADMIN, `${label}-admin`), emp: await makeEmployee(org.id, Role.EMPLOYEE, `${label}-emp`), mgr: await makeEmployee(org.id, Role.MANAGER, `${label}-mgr`) };
  }

  const as = (who: { cookie: string }) => ({ get: (p: string) => request(server()).get(p).set("Cookie", who.cookie), post: (p: string) => request(server()).post(p).set("Cookie", who.cookie), patch: (p: string) => request(server()).patch(p).set("Cookie", who.cookie), del: (p: string) => request(server()).delete(p).set("Cookie", who.cookie) });
  const ext = (token: string) => ({ get: (p: string) => request(server()).get(`/api/v1/ext${p}`).set("Authorization", `Bearer ${token}`), post: (p: string) => request(server()).post(`/api/v1/ext${p}`).set("Authorization", `Bearer ${token}`) });
  async function newCredential(org: Org, scopes: string[], extra: Record<string, unknown> = {}) {
    const res = await as(org.admin).post("/api/v1/integrations/credentials").send({ name: "Zapier", scopes, ...extra }).expect(201);
    return { id: res.body.id as string, secret: res.body.secret as string };
  }
  const mkLead = (org: Org, name: string, phone?: string, ownerId?: string) => prisma.lead.create({ data: { organizationId: org.id, fullName: name, phone, createdById: org.admin.id, ownerId } });

  beforeAll(async () => {
    process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    (app as NestExpressApplication).useBodyParser("json", { limit: "1mb", verify: (req: { rawBody?: Buffer }, _res: unknown, buf: Buffer) => { req.rawBody = buf; } });
    app.use(cookieParser());
    app.use(createCsrfOriginCheck(["https://app.example.com"]));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    dispatcher = app.get(WebhookDispatcher);
    a = await makeOrg("iA");
    b = await makeOrg("iB");
    // the CSRF middleware accepts the browser session calls via Origin
    void argon2;
  });

  afterAll(async () => {
    await prisma.providerCallEvent.deleteMany({});
    await prisma.telephonyProvider.deleteMany({});
    await prisma.webhookDelivery.deleteMany({});
    await prisma.webhookEndpoint.deleteMany({});
    await prisma.integrationCredential.deleteMany({});
    await prisma.idempotencyRecord.deleteMany({});
    await prisma.apiKey.deleteMany({});
    await prisma.mobileAuthToken.deleteMany({});
    await prisma.mobileContact.deleteMany({});
    await prisma.mobileCall.deleteMany({});
    await prisma.mobileDevice.deleteMany({});
    await prisma.leadFollowUp.deleteMany({});
    await prisma.leadActivity.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.pipelineStage.deleteMany({});
    await prisma.pipeline.deleteMany({});
    await prisma.leadScoreConfig.deleteMany({});
    await prisma.auditEvent.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.employee.deleteMany({});
    await prisma.organization.deleteMany({});
    await app.close();
  });

  // The browser-session routes sit behind the Origin check exactly as in production.
  const origin = "https://app.example.com";
  const admin = (who: { cookie: string }) => ({
    get: (p: string) => request(server()).get(p).set("Cookie", who.cookie),
    post: (p: string) => request(server()).post(p).set("Cookie", who.cookie).set("Origin", origin),
    patch: (p: string) => request(server()).patch(p).set("Cookie", who.cookie).set("Origin", origin),
    del: (p: string) => request(server()).delete(p).set("Cookie", who.cookie).set("Origin", origin),
  });
  void as;

  async function credential(org: Org, scopes: string[], extra: Record<string, unknown> = {}) {
    const res = await admin(org.admin).post("/api/v1/integrations/credentials").send({ name: "Zapier", scopes, ...extra }).expect(201);
    return { id: res.body.id as string, secret: res.body.secret as string, body: res.body };
  }
  void newCredential;

  describe("API credentials", () => {
    it("only COMPANY_ADMIN and above can manage integrations", async () => {
      await admin(a.emp).get("/api/v1/integrations/credentials").expect(403);
      await admin(a.mgr).post("/api/v1/integrations/credentials").send({ name: "x", scopes: ["leads:read"] }).expect(403);
      await admin(a.admin).get("/api/v1/integrations/directory").expect(200);
    });

    it("requires explicit scopes (no access by default) and rejects unknown ones", async () => {
      await admin(a.admin).post("/api/v1/integrations/credentials").send({ name: "x", scopes: [] }).expect(400);
      await admin(a.admin).post("/api/v1/integrations/credentials").send({ name: "x" }).expect(400);
      const bad = await admin(a.admin).post("/api/v1/integrations/credentials").send({ name: "x", scopes: ["admin:everything"] }).expect(400);
      expect(bad.body.error.message).toMatch(/Unknown scope/);
    });

    it("shows the secret exactly once, stores only a hash, and records owner, expiry and an audit event", async () => {
      const c = await credential(a, ["leads:read"]);
      expect(c.secret).toMatch(/^zlk_/);
      expect(c.body.expiresAt).toBeTruthy();
      const stored = await prisma.integrationCredential.findUniqueOrThrow({ where: { id: c.id } });
      expect(stored.tokenHash).toBe(sha(c.secret));
      expect(JSON.stringify(stored)).not.toContain(c.secret);
      const list = await admin(a.admin).get("/api/v1/integrations/credentials").expect(200);
      expect(JSON.stringify(list.body)).not.toContain(c.secret);
      const row = list.body.find((r: { id: string }) => r.id === c.id);
      expect(row).toMatchObject({ name: "Zapier", owner: expect.any(String), status: "active", scopes: ["leads:read"] });
      expect(await prisma.auditEvent.count({ where: { organizationId: a.id, action: "integration_credential.created", targetId: c.id } })).toBe(1);
    });

    it("authenticates /ext, is bound to its own organization, and paginates incrementally with a stable cursor", async () => {
      const c = await credential(a, ["leads:read"]);
      for (const n of ["L1", "L2", "L3", "L4", "L5"]) await mkLead(a, n);
      await mkLead(b, "B-secret-lead");
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: request.Response = await ext(c.secret).get(`/leads?limit=2${cursor ? `&cursor=${cursor}` : ""}`).expect(200);
        seen.push(...res.body.data.map((l: { fullName: string }) => l.fullName));
        cursor = res.body.nextCursor as string | null;
        pages++;
      } while (cursor && pages < 10);
      expect(seen).toEqual(expect.arrayContaining(["L1", "L2", "L3", "L4", "L5"]));
      expect(seen).not.toContain("B-secret-lead");
      expect(new Set(seen).size).toBe(seen.length); // no repeats
      expect(pages).toBeGreaterThanOrEqual(3);
      await ext(c.secret).get("/leads?cursor=garbage").expect(400);
    });

    it("a lead in another organization is a 404, not a 403", async () => {
      const c = await credential(a, ["leads:read"]);
      const foreign = await mkLead(b, "Foreign");
      await ext(c.secret).get(`/leads/${foreign.id}`).expect(404);
    });

    it("enforces scopes per route and returns a clear error", async () => {
      const c = await credential(a, ["leads:read"]);
      const res = await ext(c.secret).post("/leads").send({ fullName: "Nope" }).expect(403);
      expect(res.body.error.code).toBe("INSUFFICIENT_SCOPE");
      expect(res.body.error.message).toMatch(/leads:write/);
      await ext(c.secret).get("/calls").expect(403);
    });

    it("rejects missing, malformed and unknown credentials identically", async () => {
      const r1 = await request(server()).get("/api/v1/ext/leads").expect(401);
      const r2 = await ext("zlk_not-a-real-one").get("/leads").expect(401);
      const r3 = await ext("hello").get("/leads").expect(401);
      expect(new Set([r1.body.error.message, r2.body.error.message, r3.body.error.message]).size).toBe(1);
      expect(r1.headers["x-request-id"]).toBeTruthy();
    });

    it("revocation is immediate", async () => {
      const c = await credential(a, ["leads:read"]);
      await ext(c.secret).get("/leads").expect(200);
      await admin(a.admin).del(`/api/v1/integrations/credentials/${c.id}`).expect(200);
      await ext(c.secret).get("/leads").expect(401);
    });

    it("rotation invalidates the old secret immediately and the new one works", async () => {
      const c = await credential(a, ["leads:read"]);
      const rot = await admin(a.admin).post(`/api/v1/integrations/credentials/${c.id}/rotate`).expect(200);
      expect(rot.body.secret).not.toBe(c.secret);
      await ext(c.secret).get("/leads").expect(401);
      await ext(rot.body.secret).get("/leads").expect(200);
    });

    it("expired credentials and credentials whose owner left the company stop working", async () => {
      const c = await credential(a, ["leads:read"]);
      await prisma.integrationCredential.update({ where: { id: c.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await ext(c.secret).get("/leads").expect(401);

      const owner = await makeEmployee(a.id, Role.COMPANY_ADMIN, "leaver");
      const made = await admin(owner).post("/api/v1/integrations/credentials").send({ name: "Leaver key", scopes: ["leads:read"] }).expect(201);
      await ext(made.body.secret).get("/leads").expect(200);
      await prisma.employee.update({ where: { id: owner.id }, data: { employmentStatus: "SEPARATED" } });
      await ext(made.body.secret).get("/leads").expect(401);
    });

    it("tenant isolation: another organization's admin cannot see, rotate or revoke this credential", async () => {
      const c = await credential(a, ["leads:read"]);
      const list = await admin(b.admin).get("/api/v1/integrations/credentials").expect(200);
      expect(list.body.find((r: { id: string }) => r.id === c.id)).toBeUndefined();
      await admin(b.admin).post(`/api/v1/integrations/credentials/${c.id}/rotate`).expect(404);
      await admin(b.admin).del(`/api/v1/integrations/credentials/${c.id}`).expect(404);
      await ext(c.secret).get("/leads").expect(200);
    });

    it("credentials, personal API keys (MCP) and phone tokens are separate worlds", async () => {
      const c = await credential(a, ["leads:read", "leads:write"]);
      // a machine credential cannot act as an employee
      await request(server()).get("/api/v1/leads/my-day").set("Authorization", `Bearer ${c.secret}`).expect(401);
      await request(server()).get("/api/v1/integrations/credentials").set("Authorization", `Bearer ${c.secret}`).expect(401);
      // a personal API key (what MCP uses) cannot reach /ext ...
      const raw = "zlv_" + randomBytes(24).toString("base64url");
      await prisma.apiKey.create({ data: { employeeId: a.admin.id, name: "mcp", tokenHash: sha(raw), lastFour: raw.slice(-4) } });
      await ext(raw).get("/leads").expect(401);
      // ... and, even for an admin, cannot mint credentials or change webhooks
      const mint = await request(server()).post("/api/v1/integrations/credentials").set("Authorization", `Bearer ${raw}`).send({ name: "evil", scopes: ["leads:read"] });
      expect(mint.status).toBe(403);
      await request(server()).get("/api/v1/integrations/webhooks").set("Authorization", `Bearer ${raw}`).expect(403);
    });

    it("a phone token (even an admin's) cannot manage integrations or use /ext", async () => {
      const hash = await argon2.hash("Pw-for-integration-test-1!", { type: argon2.argon2id, memoryCost: 4096, timeCost: 2, parallelism: 1 });
      await prisma.employee.update({ where: { id: a.admin.id }, data: { passwordHash: hash } });
      const login = await request(server()).post("/api/v1/mobile/auth/login").send({ email: a.admin.email, password: "Pw-for-integration-test-1!", device: { installId: "install-int-0123456789abcdef", name: "p" } }).expect(200);
      const tok = login.body.accessToken as string;
      await request(server()).get("/api/v1/integrations/credentials").set("Authorization", `Bearer ${tok}`).expect(403);
      await request(server()).post("/api/v1/integrations/webhooks").set("Authorization", `Bearer ${tok}`).send({ name: "x", url: "https://example.com", events: ["lead.created"] }).expect(403);
      await ext(tok).get("/leads").expect(401);
    });

    it("POST /ext/leads is idempotent per Idempotency-Key, refuses duplicate numbers, and is audited", async () => {
      const c = await credential(a, ["leads:read", "leads:write"]);
      const key = `ext-lead-${stamp}-1`;
      const send = () => ext(c.secret).post("/leads").set("Idempotency-Key", key).send({ fullName: "Ext Lead", phone: "+91 98000 77001", email: "e@x.test" });
      const r1 = await send().expect(201);
      const r2 = await send().expect(201);
      expect(r2.headers["idempotent-replayed"]).toBe("true");
      expect(r2.body.id).toBe(r1.body.id);
      expect(await prisma.lead.count({ where: { organizationId: a.id, fullName: "Ext Lead" } })).toBe(1);
      const dup = await ext(c.secret).post("/leads").send({ fullName: "Same Number", phone: "9800077001" }).expect(409);
      expect(dup.body.error.code).toBe("DUPLICATE_LEAD");
      expect(await prisma.auditEvent.count({ where: { organizationId: a.id, action: "ext.lead_created", targetId: r1.body.id } })).toBe(1);
      expect(r1.body.source).toBe("api:Zapier");
      await ext(c.secret).post("/leads").send({ fullName: "x", organizationId: b.id }).expect(400); // body cannot name an organization
    });

    it("validates input and refuses unknown fields", async () => {
      const c = await credential(a, ["leads:write"]);
      await ext(c.secret).post("/leads").send({}).expect(400);
      await ext(c.secret).post("/leads").send({ fullName: "X", phone: "abc" }).expect(422);
    });
  });

  describe("webhooks", () => {
    let receiver: http.Server;
    let url: string;
    let received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
    let respond: (n: number) => number = () => 200;

    beforeAll(async () => {
      receiver = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          received.push({ headers: req.headers, body: Buffer.concat(chunks).toString() });
          res.statusCode = respond(received.length);
          res.end("ok");
        });
      });
      await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
      url = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
    });
    afterAll(() => new Promise<void>((r) => receiver.close(() => r())));
    beforeEach(async () => {
      received = []; respond = () => 200; delete process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORKS; delete process.env.WEBHOOKS_ALLOW_HTTP;
      // a clean slate: endpoints left over from earlier tests would also receive this test's events
      await dispatcher.flush();
      await prisma.webhookDelivery.deleteMany({});
      await prisma.webhookEndpoint.deleteMany({});
    });
    const allowLocal = () => { process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORKS = "true"; process.env.WEBHOOKS_ALLOW_HTTP = "true"; };

    it.each([
      "http://example.com/hook", "https://localhost/hook", "https://127.0.0.1/hook", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/x", "https://192.168.1.1/x",
      "https://[::1]/x", "https://user:pw@93.184.216.34/x", "file:///etc/passwd", "https://printer.local/x", "https://172.16.0.9/x", "not a url",
    ])("refuses %s (SSRF / unsafe target)", async (target) => {
      await admin(a.admin).post("/api/v1/integrations/webhooks").send({ name: "bad", url: target, events: ["lead.created"] }).expect(400);
    });

    it("accepts a public https address", async () => {
      const res = await admin(a.admin).post("/api/v1/integrations/webhooks").send({ name: "ok", url: "https://93.184.216.34/hook", events: ["lead.created"] }).expect(201);
      expect(res.body.secret).toMatch(/^whsec_/);
      expect(res.body.status).toBe("active");
      await admin(a.admin).del(`/api/v1/integrations/webhooks/${res.body.id}`).expect(200);
    });

    it("rejects unknown event types and requires at least one", async () => {
      await admin(a.admin).post("/api/v1/integrations/webhooks").send({ name: "x", url: "https://93.184.216.34/h", events: ["employee.created"] }).expect(400);
      await admin(a.admin).post("/api/v1/integrations/webhooks").send({ name: "x", url: "https://93.184.216.34/h", events: [] }).expect(400);
    });

    async function hook(events: string[], org: Org = a) {
      allowLocal();
      const res = await admin(org.admin).post("/api/v1/integrations/webhooks").send({ name: `hook-${events.join("+")}`, url, events }).expect(201);
      return { id: res.body.id as string, secret: res.body.secret as string };
    }
    const verify = (secret: string, r: { headers: http.IncomingHttpHeaders; body: string }) => {
      const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(String(r.headers["x-zulivio-signature"]));
      expect(m).not.toBeNull();
      return createHmac("sha256", secret).update(`${m![1]}.${r.body}`).digest("hex") === m![2];
    };

    it("delivers a signed, versioned event with a stable id, and records delivery history", async () => {
      const h = await hook(["lead.created"]);
      const lead = await admin(a.admin).post("/api/v1/leads").send({ fullName: "Hooked Lead", phone: "9811100001" }).expect(201);
      await dispatcher.flush();
      await dispatcher.processDue();
      expect(received).toHaveLength(1);
      const r = received[0];
      const body = JSON.parse(r.body);
      expect(body).toMatchObject({ type: "lead.created", apiVersion: "2026-11-01", organizationId: a.id, data: { id: lead.body.id, fullName: "Hooked Lead" } });
      expect(body.id).toMatch(/^evt_/);
      expect(r.headers["x-zulivio-event-id"]).toBe(body.id);
      expect(r.headers["x-zulivio-event-type"]).toBe("lead.created");
      expect(verify(h.secret, r)).toBe(true);
      expect(verify("whsec_wrong", r)).toBe(false);
      const hist = await admin(a.admin).get(`/api/v1/integrations/webhooks/${h.id}/deliveries`).expect(200);
      expect(hist.body.data[0]).toMatchObject({ eventType: "lead.created", status: "success", statusCode: 200, attempts: 1 });
      expect(JSON.stringify(hist.body)).not.toContain(h.secret);
    });

    it("sends only the events the endpoint subscribed to", async () => {
      await hook(["follow_up.created"]);
      await admin(a.admin).post("/api/v1/leads").send({ fullName: "Not Subscribed" }).expect(201);
      await dispatcher.flush();
      await dispatcher.processDue();
      expect(received.filter((r) => JSON.parse(r.body).type === "lead.created")).toHaveLength(0);
    });

    it("tenant isolation: events from another organization never reach this endpoint", async () => {
      await hook(["lead.created"], a);
      await admin(b.admin).post("/api/v1/leads").send({ fullName: "Org B Lead" }).expect(201);
      await dispatcher.flush();
      await dispatcher.processDue();
      expect(received.map((r) => r.body).join("")).not.toContain("Org B Lead");
    });

    it("retries with backoff, keeps the same event id, then succeeds", async () => {
      const h = await hook(["lead.created"]);
      respond = (n) => (n === 1 ? 500 : 200);
      await admin(a.admin).post("/api/v1/leads").send({ fullName: "Retry Lead" }).expect(201);
      await dispatcher.flush();
      await dispatcher.processDue();
      let d = await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: h.id }, orderBy: { createdAt: "desc" } });
      expect(d.status).toBe("PENDING");
      expect(d.attempts).toBe(1);
      expect(d.lastStatusCode).toBe(500);
      expect(d.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
      await prisma.webhookDelivery.update({ where: { id: d.id }, data: { nextAttemptAt: new Date() } });
      await dispatcher.flush();
      await dispatcher.processDue();
      d = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(d.status).toBe("SUCCESS");
      expect(d.attempts).toBe(2);
      expect(received).toHaveLength(2);
      expect(received[0].headers["x-zulivio-event-id"]).toBe(received[1].headers["x-zulivio-event-id"]);
      expect(received[1].headers["x-zulivio-delivery-attempt"]).toBe("2");
    });

    it("gives up after the last retry (FAILED) and an admin can retry it by hand", async () => {
      const h = await hook(["lead.created"]);
      respond = () => 503;
      await admin(a.admin).post("/api/v1/leads").send({ fullName: "Doomed Lead" }).expect(201);
      await dispatcher.flush();
      const d0 = (await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: h.id }, orderBy: { createdAt: "desc" } }));
      await prisma.webhookDelivery.update({ where: { id: d0.id }, data: { attempts: 6 } });
      await dispatcher.flush();
      await dispatcher.processDue();
      const d = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d0.id } });
      expect(d.status).toBe("FAILED");
      respond = () => 200;
      await admin(a.admin).post(`/api/v1/integrations/webhook-deliveries/${d.id}/retry`).expect(200);
      await dispatcher.flush();
      await dispatcher.processDue();
      expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("SUCCESS");
    });

    it("auto-pauses an endpoint after a run of permanent failures", async () => {
      const h = await hook(["lead.created"]);
      await prisma.webhookEndpoint.update({ where: { id: h.id }, data: { consecutiveFailures: 9 } });
      respond = () => 500;
      await admin(a.admin).post("/api/v1/leads").send({ fullName: "Pause Trigger" }).expect(201);
      await dispatcher.flush();
      const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: h.id } });
      await prisma.webhookDelivery.update({ where: { id: d.id }, data: { attempts: 6 } });
      await dispatcher.flush();
      await dispatcher.processDue();
      expect((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: h.id } })).status).toBe("PAUSED");
      expect(await prisma.auditEvent.count({ where: { organizationId: a.id, action: "webhook.auto_paused", targetId: h.id } })).toBe(1);
    });

    it("pause stops new deliveries; resume restores them", async () => {
      const h = await hook(["lead.created"]);
      await admin(a.admin).patch(`/api/v1/integrations/webhooks/${h.id}`).send({ status: "paused" }).expect(200);
      await admin(a.admin).post("/api/v1/leads").send({ fullName: "While Paused" }).expect(201);
      await dispatcher.flush();
      await dispatcher.processDue();
      expect(received).toHaveLength(0);
      await admin(a.admin).patch(`/api/v1/integrations/webhooks/${h.id}`).send({ status: "active" }).expect(200);
      await admin(a.admin).post("/api/v1/leads").send({ fullName: "After Resume" }).expect(201);
      await dispatcher.flush();
      await dispatcher.processDue();
      expect(received.map((r) => r.body).join("")).toContain("After Resume");
      expect(received.map((r) => r.body).join("")).not.toContain("While Paused");
    });

    it("secret rotation takes effect immediately", async () => {
      const h = await hook(["lead.created"]);
      const rot = await admin(a.admin).post(`/api/v1/integrations/webhooks/${h.id}/rotate-secret`).expect(200);
      await admin(a.admin).post("/api/v1/leads").send({ fullName: "After Rotation" }).expect(201);
      await dispatcher.flush();
      await dispatcher.processDue();
      expect(verify(rot.body.secret, received[0])).toBe(true);
      expect(verify(h.secret, received[0])).toBe(false);
    });

    it("test delivery sends webhook.test, records it, and reports failure honestly", async () => {
      const h = await hook(["lead.created"]);
      const ok = await admin(a.admin).post(`/api/v1/integrations/webhooks/${h.id}/test`).expect(200);
      expect(ok.body).toMatchObject({ eventType: "webhook.test", status: "success", isTest: true });
      expect(received[0].headers["x-zulivio-event-type"]).toBe("webhook.test");
      respond = () => 404;
      const bad = await admin(a.admin).post(`/api/v1/integrations/webhooks/${h.id}/test`).expect(200);
      expect(bad.body).toMatchObject({ status: "failed", statusCode: 404 });
    });

    it("revoke stops delivery, fails queued events, and hides the endpoint; another org cannot touch it", async () => {
      const h = await hook(["lead.created"]);
      await admin(b.admin).del(`/api/v1/integrations/webhooks/${h.id}`).expect(404);
      await admin(b.admin).post(`/api/v1/integrations/webhooks/${h.id}/test`).expect(404);
      await admin(a.admin).post("/api/v1/leads").send({ fullName: "Queued Then Revoked" }).expect(201);
      await admin(a.admin).del(`/api/v1/integrations/webhooks/${h.id}`).expect(200);
      await dispatcher.flush();
      await dispatcher.processDue();
      expect(received).toHaveLength(0);
      const list = await admin(a.admin).get("/api/v1/integrations/webhooks").expect(200);
      expect(list.body.find((w: { id: string }) => w.id === h.id)).toBeUndefined();
      await admin(a.admin).post(`/api/v1/integrations/webhooks/${h.id}/test`).expect(404);
      expect(await prisma.auditEvent.count({ where: { organizationId: a.id, action: "webhook.revoked", targetId: h.id } })).toBe(1);
    });

    it("the signing secret is encrypted at rest", async () => {
      const h = await hook(["lead.created"]);
      const row = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: h.id } });
      expect(row.secretEnc).not.toContain(h.secret);
      expect(row.secretEnc.startsWith("v1:")).toBe(true);
    });

    it("never delivers to a private address at send time unless the operator opted in (DNS-rebinding style guard)", async () => {
      const h = await hook(["lead.created"]); // registered while the opt-in was on
      delete process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORKS; // opt-in withdrawn before delivery
      await admin(a.admin).post("/api/v1/leads").send({ fullName: "Blocked At Send" }).expect(201);
      await dispatcher.flush();
      await dispatcher.processDue();
      expect(received).toHaveLength(0);
      const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: h.id }, orderBy: { createdAt: "desc" } });
      expect(d.lastError).toMatch(/private network/);
    });

    it("signPayload matches the documented construction", () => {
      expect(signPayload("s", 1700000000, "{}")).toBe(createHmac("sha256", "s").update("1700000000.{}").digest("hex"));
    });
  });

  describe("telephony provider events", () => {
    let prov: { id: string; secret: string };
    let leadA: { id: string };
    const sign = (secret: string, body: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
    const send = (p: { id: string; secret: string }, payload: object, headers: Record<string, string> = {}, signed = true) => {
      const body = JSON.stringify(payload);
      const r = request(server()).post(`/api/v1/integrations/telephony/${p.id}/events`).set("Content-Type", "application/json");
      if (signed) r.set("X-Zulivio-Signature", sign(p.secret, body));
      Object.entries(headers).forEach(([k, v]) => r.set(k, v));
      return r.send(body);
    };
    const call = (over: Record<string, unknown> = {}) => ({ call_id: `c-${randomBytes(4).toString("hex")}`, event: "completed", direction: "inbound", from: "+91 98123 45678", started_at: new Date(Date.now() - 90_000).toISOString(), ended_at: new Date().toISOString(), duration: 90, agent_email: a.emp.email, ...over });

    beforeAll(async () => {
      const res = await admin(a.admin).post("/api/v1/integrations/telephony").send({ name: "Acme PBX" }).expect(201);
      prov = { id: res.body.id, secret: res.body.secret };
      leadA = await mkLead(a, "Phone Lead A", "+919812345678", a.emp.id);
      await mkLead(b, "Phone Lead B", "+919812345678");
    });

    it("creates a provider with a one-time secret that is encrypted at rest", async () => {
      expect(prov.secret).toMatch(/^tpsec_/);
      const row = await prisma.telephonyProvider.findUniqueOrThrow({ where: { id: prov.id } });
      expect(row.secretEnc).not.toContain(prov.secret);
      const list = await admin(a.admin).get("/api/v1/integrations/telephony").expect(200);
      expect(JSON.stringify(list.body)).not.toContain(prov.secret);
      expect(list.body[0].eventUrlPath).toBe(`/api/v1/integrations/telephony/${prov.id}/events`);
    });

    it("test connection is a dry run: shows the extracted event, stores nothing", async () => {
      const before = await prisma.providerCallEvent.count();
      const t = await admin(a.admin).post(`/api/v1/integrations/telephony/${prov.id}/test`).send({}).expect(200);
      expect(t.body.ok).toBe(true);
      expect(t.body.normalized).toMatchObject({ eventType: "completed", direction: "inbound" });
      const bad = await admin(a.admin).post(`/api/v1/integrations/telephony/${prov.id}/test`).send({ payload: { nothing: "useful" } }).expect(200);
      expect(bad.body.ok).toBe(false);
      expect(await prisma.providerCallEvent.count()).toBe(before);
      expect((await admin(a.admin).get("/api/v1/integrations/telephony").expect(200)).body[0].delivery.lastTestAt).toBeTruthy();
    });

    it("accepts a correctly signed event, links it to the right organization's lead, and labels it provider_imported", async () => {
      const payload = call({ call_id: "pbx-1001" });
      const res = await send(prov, payload).expect(200);
      expect(res.body).toMatchObject({ success: true, duplicate: false });
      const ev = await prisma.providerCallEvent.findFirstOrThrow({ where: { providerId: prov.id, providerCallId: "pbx-1001" } });
      expect(ev.organizationId).toBe(a.id);
      expect(ev.leadId).toBe(leadA.id);
      expect(ev.employeeId).toBe(a.emp.id);
      const act = await prisma.leadActivity.findFirstOrThrow({ where: { leadId: leadA.id, type: "CALL" } });
      expect(act.callOutcome).toBe("CONNECTED");
      expect(act.callDurationSeconds).toBe(90);
      expect((act.metadata as { source: string }).source).toBe("provider_imported");
      // org B's lead with the same number is untouched
      expect(await prisma.leadActivity.count({ where: { organizationId: b.id } })).toBe(0);
    });

    it("is idempotent: a provider retry doesn't create a second event or timeline entry", async () => {
      const payload = call({ call_id: "pbx-1002" });
      await send(prov, payload).expect(200);
      const again = await send(prov, payload).expect(200);
      expect(again.body.duplicate).toBe(true);
      expect(await prisma.providerCallEvent.count({ where: { providerId: prov.id, providerCallId: "pbx-1002" } })).toBe(1);
      expect(await prisma.leadActivity.count({ where: { leadId: leadA.id, metadata: { path: ["providerCallId"], equals: "pbx-1002" } } })).toBe(1);
    });

    it("a missed call is recorded as not connected, with no invented duration", async () => {
      await send(prov, call({ call_id: "pbx-1003", event: "no-answer", duration: undefined })).expect(200);
      const act = await prisma.leadActivity.findFirstOrThrow({ where: { leadId: leadA.id, metadata: { path: ["providerCallId"], equals: "pbx-1003" } } });
      expect(act.callOutcome).toBe("NOT_CONNECTED");
      expect(act.callDurationSeconds).toBeNull();
    });

    it("started/answered events are kept but don't add a result to the timeline", async () => {
      const before = await prisma.leadActivity.count({ where: { leadId: leadA.id } });
      await send(prov, call({ call_id: "pbx-1004", event: "ringing" })).expect(200);
      expect(await prisma.leadActivity.count({ where: { leadId: leadA.id } })).toBe(before);
    });

    it("rejects missing, wrong, tampered, stale and unknown-provider signatures", async () => {
      const body = JSON.stringify(call());
      const post = (id: string, headers: Record<string, string>) => request(server()).post(`/api/v1/integrations/telephony/${id}/events`).set("Content-Type", "application/json").set(headers).send(body);
      await post(prov.id, {}).expect(401);
      await post(prov.id, { "X-Zulivio-Signature": sign("tpsec_wrong", body) }).expect(401);
      await post(prov.id, { "X-Zulivio-Signature": sign(prov.secret, body + " ") }).expect(401); // body changed after signing
      const stale = await post(prov.id, { "X-Zulivio-Signature": sign(prov.secret, body, Math.floor(Date.now() / 1000) - 3600) }).expect(401);
      expect(stale.body.error.code).toBe("STALE_SIGNATURE");
      await post("00000000-0000-4000-8000-000000000000", { "X-Zulivio-Signature": sign(prov.secret, body) }).expect(401);
      // a malformed id never reaches the handler (the origin check refuses it first); either way it is rejected
      expect([401, 403]).toContain((await post("not-a-uuid", { "X-Zulivio-Signature": sign(prov.secret, body) })).status);
      const p = (await admin(a.admin).get("/api/v1/integrations/telephony").expect(200)).body[0];
      expect(p.delivery.eventsRejected).toBeGreaterThanOrEqual(3);
      expect(p.delivery.lastError).toBeTruthy();
    });

    it("the organization comes from the provider, never from the payload", async () => {
      const before = await prisma.leadActivity.count({ where: { organizationId: b.id } });
      await send(prov, { ...call({ call_id: "pbx-1005" }), organizationId: b.id, employeeId: b.emp.id, leadId: "x" }).expect(200);
      expect(await prisma.leadActivity.count({ where: { organizationId: b.id } })).toBe(before);
      expect((await prisma.providerCallEvent.findFirstOrThrow({ where: { providerCallId: "pbx-1005" } })).organizationId).toBe(a.id);
    });

    it("reports unmappable payloads with a clear reason and counts them", async () => {
      const res = await send(prov, call({ event: "teleported" })).expect(422);
      expect(res.body.error.code).toBe("MAPPING_FAILED");
      expect(res.body.error.message).toMatch(/not mapped/);
      const res2 = await send(prov, { event: "completed" }).expect(422);
      expect(res2.body.error.message).toMatch(/call id/);
    });

    it("supports nested field mappings and custom event words", async () => {
      const r = await admin(a.admin).post("/api/v1/integrations/telephony").send({ name: "Nested PBX", fields: { providerCallId: "data.call.id", eventType: "data.state", customerPhone: "data.call.caller", duration: "data.call.secs", direction: "data.dir" }, statusMap: { finished: "completed" } }).expect(201);
      const p = { id: r.body.id as string, secret: r.body.secret as string };
      await send(p, { data: { state: "finished", dir: "incoming", call: { id: "n-1", caller: "9812345678", secs: 30 } } }).expect(200);
      const ev = await prisma.providerCallEvent.findFirstOrThrow({ where: { providerId: p.id } });
      expect(ev).toMatchObject({ providerCallId: "n-1", eventType: "completed", direction: "inbound", durationSeconds: 30 });
      await admin(a.admin).post("/api/v1/integrations/telephony").send({ name: "Bad", fields: { providerCallId: "a b; drop" } }).expect(400);
      await admin(a.admin).post("/api/v1/integrations/telephony").send({ name: "Bad2", fields: { nonsense: "x" } }).expect(400);
    });

    it("token mode works for providers that can only send a static header", async () => {
      const r = await admin(a.admin).post("/api/v1/integrations/telephony").send({ name: "Token PBX", auth: "token" }).expect(201);
      const body = JSON.stringify(call({ call_id: "tok-1" }));
      const go = (h: Record<string, string>) => request(server()).post(`/api/v1/integrations/telephony/${r.body.id}/events`).set("Content-Type", "application/json").set(h).send(body);
      await go({ "X-Zulivio-Token": r.body.secret }).expect(200);
      await go({ "X-Zulivio-Token": "tpsec_wrong" }).expect(401);
      await go({}).expect(401);
    });

    it("a disabled provider refuses events", async () => {
      await admin(a.admin).patch(`/api/v1/integrations/telephony/${prov.id}`).send({ enabled: false }).expect(200);
      await send(prov, call()).expect(401);
      await admin(a.admin).patch(`/api/v1/integrations/telephony/${prov.id}`).send({ enabled: true }).expect(200);
    });

    it("another organization cannot read or change this provider", async () => {
      await admin(b.admin).patch(`/api/v1/integrations/telephony/${prov.id}`).send({ enabled: false }).expect(404);
      await admin(b.admin).post(`/api/v1/integrations/telephony/${prov.id}/rotate-secret`).expect(404);
      await admin(b.admin).get(`/api/v1/integrations/telephony/${prov.id}/events`).expect(404);
      expect((await admin(b.admin).get("/api/v1/integrations/telephony").expect(200)).body).toHaveLength(0);
    });

    it("secret rotation invalidates the old secret at once", async () => {
      const r = await admin(a.admin).post(`/api/v1/integrations/telephony/${prov.id}/rotate-secret`).expect(200);
      await send(prov, call()).expect(401);
      prov = { id: prov.id, secret: r.body.secret };
      await send(prov, call({ call_id: "pbx-after-rotate" })).expect(200);
    });

    it("fires a call.recorded webhook when a provider event arrives", async () => {
      process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORKS = "true"; process.env.WEBHOOKS_ALLOW_HTTP = "true";
      const got: string[] = [];
      const srv = http.createServer((req, res) => { const c: Buffer[] = []; req.on("data", (d: Buffer) => c.push(d)); req.on("end", () => { got.push(Buffer.concat(c).toString()); res.end("ok"); }); });
      await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
      try {
        await admin(a.admin).post("/api/v1/integrations/webhooks").send({ name: "calls", url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/h`, events: ["call.recorded"] }).expect(201);
        await send(prov, call({ call_id: "pbx-hook-1" })).expect(200);
        await dispatcher.flush();
      await dispatcher.processDue();
        expect(got.some((b) => JSON.parse(b).type === "call.recorded" && JSON.parse(b).data.providerCallId === "pbx-hook-1")).toBe(true);
      } finally {
        await new Promise<void>((r) => srv.close(() => r()));
        delete process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORKS; delete process.env.WEBHOOKS_ALLOW_HTTP;
      }
    });

    it("/ext/calls records and lists call events with the right scopes, idempotently", async () => {
      const c = await credential(a, ["calls:read", "calls:write"]);
      const payload = { provider_call_id: "ext-call-1", event_type: "completed", direction: "outbound", phone_number: "+919812345678", duration_seconds: 42, agent_email: a.emp.email };
      const r1 = await ext(c.secret).post("/calls").send(payload).expect(201);
      const r2 = await ext(c.secret).post("/calls").send(payload).expect(201);
      expect(r1.body.duplicate).toBe(false);
      expect(r2.body.duplicate).toBe(true);
      const list = await ext(c.secret).get("/calls?limit=100").expect(200);
      expect(list.body.data.some((e: { providerCallId: string }) => e.providerCallId === "ext-call-1")).toBe(true);
      expect(JSON.stringify(list.body)).not.toContain("pbx-hook-1x");
      await ext(c.secret).post("/calls").send({ ...payload, event_type: "exploded" }).expect(400);
    });
  });

  describe("destructive lead actions are audited", () => {
    it("single delete, bulk delete and delete-all each leave an audit event naming the actor", async () => {
      const one = await mkLead(a, "Audit One", undefined, a.emp.id);
      await admin(a.admin).del(`/api/v1/leads/${one.id}`).expect(200);
      expect(await prisma.auditEvent.count({ where: { organizationId: a.id, action: "lead.deleted", targetId: one.id, actorId: a.admin.id } })).toBe(1);

      const two = await mkLead(a, "Audit Two");
      const three = await mkLead(a, "Audit Three");
      await admin(a.admin).post("/api/v1/leads/bulk/delete").send({ leadIds: [two.id, three.id] }).expect(201);
      const bulk = await prisma.auditEvent.findFirstOrThrow({ where: { organizationId: a.id, action: "lead.bulk_deleted" } });
      expect(bulk.actorId).toBe(a.admin.id);
      expect((bulk.metadata as { count: number }).count).toBe(2);

      await mkLead(a, "Audit Four");
      const bLead = await mkLead(b, "Org B survivor");
      await admin(a.admin).post("/api/v1/leads/bulk/delete-all").send({ acknowledge: true }).expect(201);
      expect(await prisma.auditEvent.count({ where: { organizationId: a.id, action: "lead.delete_all_matching" } })).toBe(1);
      // another organization's data was untouched
      expect(await prisma.lead.findUnique({ where: { id: bLead.id } })).not.toBeNull();
    });
  });

  describe("directory", () => {
    it("lists only connectors that are implemented, with honest status", async () => {
      const res = await admin(a.admin).get("/api/v1/integrations/directory").expect(200);
      const keys = res.body.items.map((i: { key: string }) => i.key);
      expect(keys).toEqual(expect.arrayContaining(["api-clients", "webhooks", "telephony", "mobile-devices", "google-sheets", "mcp"]));
      expect(res.body.items.find((i: { key: string }) => i.key === "google-sheets").status).toBe("not_configured");
      const cat = await admin(a.admin).get("/api/v1/integrations/catalog").expect(200);
      expect(cat.body.events.map((e: { type: string }) => e.type)).not.toContain("employee.created");
    });
  });
});
