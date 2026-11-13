import { randomBytes } from "node:crypto";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Role } from "@prisma/client";
import * as argon2 from "argon2";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { createCsrfOriginCheck } from "../src/common/csrf-origin-check";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { PrismaService } from "../src/prisma/prisma.service";

const stamp = Date.now();
const PASSWORD = "Correct-Horse-9!";
const INSTALL = (n: string) => `install-${n}-${"x".repeat(20)}`.slice(0, 40);

describe("Mobile app auth + contacts (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();
  let hash: string;

  type Emp = { id: string; email: string };
  async function makeOrg(label: string) {
    const org = await prisma.organization.create({ data: { name: `${label} ${stamp}` } });
    const mk = async (role: Role, tag: string, managerId?: string): Promise<Emp> => {
      const e = await prisma.employee.create({
        data: {
          organizationId: org.id,
          employeeNumber: `${label}-${tag}-${stamp}`,
          fullName: `${label} ${tag}`,
          email: `${label}-${tag}-${stamp}@e2e.local`.toLowerCase(),
          passwordHash: hash,
          role,
          mustChangePassword: false,
          managerId,
        },
      });
      return { id: e.id, email: e.email };
    };
    const admin = await mk(Role.COMPANY_ADMIN, "admin");
    const emp = await mk(Role.EMPLOYEE, "emp");
    const emp2 = await mk(Role.EMPLOYEE, "emp2");
    return { id: org.id, admin, emp, emp2 };
  }

  const login = (email: string, install: string, password = PASSWORD) =>
    request(server()).post("/api/v1/mobile/auth/login").send({ email, password, device: { installId: install, name: "Test phone", platform: "android", appVersion: "1.0.0" } });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let a: Awaited<ReturnType<typeof makeOrg>>;
  let b: Awaited<ReturnType<typeof makeOrg>>;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    // main.ts installs this in production; the app must work through it exactly as a real phone does (no Origin header).
    app.use(createCsrfOriginCheck(["https://app.example.com"]));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 4096, timeCost: 2, parallelism: 1 });
    a = await makeOrg("mA");
    b = await makeOrg("mB");
  });

  // Same convention as the other suites: leave an empty database behind.
  afterAll(async () => {
    await prisma.idempotencyRecord.deleteMany({});
    await prisma.mobileContact.deleteMany({});
    await prisma.mobileAuthToken.deleteMany({});
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

  describe("authentication", () => {
    it("server-info is public and reveals no organization data", async () => {
      const res = await request(server()).get("/api/v1/mobile/server-info").expect(200);
      expect(res.body.product).toBe("zulivio");
      expect(JSON.stringify(res.body)).not.toContain("mA");
    });

    it("rejects a wrong password and an unknown email identically", async () => {
      const bad = await login(a.emp.email, INSTALL("bad"), "nope-nope-nope").expect(401);
      const none = await login("nobody@e2e.local", INSTALL("bad"), "nope-nope-nope").expect(401);
      expect(bad.body.error.message).toBe(none.body.error.message);
    });

    it("rejects a malformed install id", async () => {
      await request(server()).post("/api/v1/mobile/auth/login").send({ email: a.emp.email, password: PASSWORD, device: { installId: "short", name: "x" } }).expect(400);
    });

    it("signs in, enrolls a device row, and issues short-lived + refresh tokens", async () => {
      const res = await login(a.emp.email, INSTALL("one")).expect(200);
      expect(res.body.accessToken).toMatch(/^zla_/);
      expect(res.body.refreshToken).toMatch(/^zlr_/);
      expect(new Date(res.body.accessExpiresAt).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000 + 2000);
      const dev = await prisma.mobileDevice.findUniqueOrThrow({ where: { id: res.body.device.id } });
      expect(dev.enrollment).toBe("APP");
      expect(dev.employeeId).toBe(a.emp.id);
      // Only hashes are stored.
      const stored = await prisma.mobileAuthToken.findMany({ where: { deviceId: dev.id } });
      expect(stored.some((t) => t.tokenHash === res.body.accessToken)).toBe(false);
    });

    it("is idempotent per installation: signing in twice reuses one device row", async () => {
      const r1 = await login(a.emp.email, INSTALL("same")).expect(200);
      const r2 = await login(a.emp.email, INSTALL("same")).expect(200);
      expect(r2.body.device.id).toBe(r1.body.device.id);
    });

    it("gives each account on the same phone its own device (account switching)", async () => {
      const r1 = await login(a.emp.email, INSTALL("shared")).expect(200);
      const r2 = await login(a.emp2.email, INSTALL("shared")).expect(200);
      expect(r2.body.device.id).not.toBe(r1.body.device.id);
    });

    it("/auth/me validates a session; a garbage token is 401", async () => {
      const s = await login(a.emp.email, INSTALL("me")).expect(200);
      const me = await request(server()).get("/api/v1/mobile/auth/me").set(auth(s.body.accessToken)).expect(200);
      expect(me.body.employee.email).toBe(a.emp.email);
      await request(server()).get("/api/v1/mobile/auth/me").set(auth("zla_garbage")).expect(401);
    });
  });

  describe("scope: a mobile token only reaches the mobile allowlist", () => {
    it("works on CRM endpoints with the employee's own role checks", async () => {
      const s = await login(a.emp.email, INSTALL("crm")).expect(200);
      await request(server()).get("/api/v1/leads/my-day").set(auth(s.body.accessToken)).expect(200);
      await request(server()).get("/api/v1/employees/me").set(auth(s.body.accessToken)).expect(200);
    });

    it("denies administration even for a COMPANY_ADMIN's phone", async () => {
      const s = await login(a.admin.email, INSTALL("admin")).expect(200);
      const t = s.body.accessToken as string;
      await request(server()).post("/api/v1/api-keys").set(auth(t)).send({ name: "x" }).expect(403);
      await request(server()).get("/api/v1/backups").set(auth(t)).expect(403);
      await request(server()).get("/api/v1/employees").set(auth(t)).expect(403);
      await request(server()).post("/api/v1/leads/bulk/delete-all").set(auth(t)).send({}).expect(403);
      await request(server()).get("/api/v1/mobile/devices").set(auth(t)).expect(403);
      await request(server()).get("/api/v1/audit-events").set(auth(t)).expect(403);
    });
  });

  describe("token lifecycle", () => {
    it("rotates refresh tokens and rejects an expired access token", async () => {
      const s = await login(a.emp.email, INSTALL("rot")).expect(200);
      const r = await request(server()).post("/api/v1/mobile/auth/refresh").send({ refreshToken: s.body.refreshToken }).expect(200);
      expect(r.body.refreshToken).not.toBe(s.body.refreshToken);
      // The pre-refresh access token is revoked as part of rotation.
      await request(server()).get("/api/v1/mobile/auth/me").set(auth(s.body.accessToken)).expect(401);
      await request(server()).get("/api/v1/mobile/auth/me").set(auth(r.body.accessToken)).expect(200);
      // Force-expire the new access token.
      await prisma.mobileAuthToken.updateMany({ where: { deviceId: s.body.device.id, kind: "ACCESS", revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await request(server()).get("/api/v1/mobile/auth/me").set(auth(r.body.accessToken)).expect(401);
    });

    it("detects refresh-token replay and burns the whole family", async () => {
      const s = await login(a.emp.email, INSTALL("replay")).expect(200);
      const r = await request(server()).post("/api/v1/mobile/auth/refresh").send({ refreshToken: s.body.refreshToken }).expect(200);
      const replay = await request(server()).post("/api/v1/mobile/auth/refresh").send({ refreshToken: s.body.refreshToken }).expect(401);
      expect(replay.body.error.code).toBe("TOKEN_REUSED");
      // The legitimate holder's newest tokens are dead too.
      await request(server()).get("/api/v1/mobile/auth/me").set(auth(r.body.accessToken)).expect(401);
      await request(server()).post("/api/v1/mobile/auth/refresh").send({ refreshToken: r.body.refreshToken }).expect(401);
      const ev = await prisma.auditEvent.findFirst({ where: { organizationId: a.id, action: "mobile.refresh_reuse_detected" } });
      expect(ev).not.toBeNull();
    });

    it("an access token cannot be used as a refresh token and vice versa", async () => {
      const s = await login(a.emp.email, INSTALL("kind")).expect(200);
      await request(server()).post("/api/v1/mobile/auth/refresh").send({ refreshToken: s.body.accessToken }).expect(401);
      await request(server()).get("/api/v1/mobile/auth/me").set(auth(s.body.refreshToken)).expect(401);
    });

    it("logout revokes immediately", async () => {
      const s = await login(a.emp.email, INSTALL("out")).expect(200);
      await request(server()).post("/api/v1/mobile/auth/logout").set(auth(s.body.accessToken)).send({}).expect(200);
      await request(server()).get("/api/v1/mobile/auth/me").set(auth(s.body.accessToken)).expect(401);
      await request(server()).post("/api/v1/mobile/auth/refresh").send({ refreshToken: s.body.refreshToken }).expect(401);
    });

    it("disabling the device takes effect on the very next request and blocks sign-in", async () => {
      const s = await login(a.emp.email, INSTALL("dis")).expect(200);
      await prisma.mobileDevice.update({ where: { id: s.body.device.id }, data: { status: "DISABLED" } });
      await request(server()).get("/api/v1/leads/my-day").set(auth(s.body.accessToken)).expect(401);
      await request(server()).post("/api/v1/mobile/auth/refresh").send({ refreshToken: s.body.refreshToken }).expect(403);
      const again = await login(a.emp.email, INSTALL("dis")).expect(403);
      expect(again.body.error.code).toBe("DEVICE_DISABLED");
    });

    it("a deactivated employee is locked out immediately", async () => {
      const victim = await prisma.employee.create({
        data: { organizationId: a.id, employeeNumber: `v-${stamp}`, fullName: "Victim", email: `victim-${stamp}@e2e.local`, passwordHash: hash, role: Role.EMPLOYEE, mustChangePassword: false },
      });
      const s = await login(victim.email, INSTALL("victim")).expect(200);
      await prisma.employee.update({ where: { id: victim.id }, data: { employmentStatus: "SEPARATED" } });
      await request(server()).get("/api/v1/leads/my-day").set(auth(s.body.accessToken)).expect(401);
    });

    it("changing the password signs the phone out", async () => {
      const u = await prisma.employee.create({
        data: { organizationId: a.id, employeeNumber: `pw-${stamp}`, fullName: "Pw", email: `pw-${stamp}@e2e.local`, passwordHash: hash, role: Role.EMPLOYEE, mustChangePassword: false },
      });
      const s = await login(u.email, INSTALL("pw")).expect(200);
      await request(server()).post("/api/v1/auth/change-password").set(auth(s.body.accessToken)).send({ currentPassword: PASSWORD, newPassword: "Another-Long-Pass-1!" }).expect(201);
      await request(server()).get("/api/v1/mobile/auth/me").set(auth(s.body.accessToken)).expect(401);
    });
  });

  describe("contacts", () => {
    let t: string; // employee A token
    let adminTok: string;
    const c = (sourceId: string, name: string, phones: string[], extra: Record<string, unknown> = {}) => ({ sourceId, displayName: name, phones, ...extra });
    const post = (token: string, path: string, body: unknown) => request(server()).post(`/api/v1/mobile/contacts${path}`).set(auth(token)).send(body as object);

    beforeAll(async () => {
      t = (await login(a.emp.email, INSTALL("contacts")).expect(200)).body.accessToken;
      adminTok = (await login(a.admin.email, INSTALL("contacts-admin")).expect(200)).body.accessToken;
    });

    it("requires a signed-in app session (a static admin device token is refused)", async () => {
      const dev = await request(server()).post("/api/v1/mobile/devices").set("Authorization", "Bearer x").send({});
      expect([401, 403]).toContain(dev.status);
      const row = await prisma.mobileDevice.create({
        data: { organizationId: a.id, employeeId: a.emp.id, deviceKey: `static-${stamp}`, name: "MacroDroid", tokenHash: "h-" + stamp, tokenLastFour: "abcd" },
      });
      // Static zlm_ tokens are hashed with sha256; craft one.
      const raw = "zlm_" + randomBytes(16).toString("hex");
      const { createHash } = await import("node:crypto");
      await prisma.mobileDevice.update({ where: { id: row.id }, data: { tokenHash: createHash("sha256").update(raw).digest("hex") } });
      const res = await post(raw, "/preview", { contacts: [] });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("APP_SESSION_REQUIRED");
    });

    it("previews NEW contacts and normalizes numbers without storing anything", async () => {
      const res = await post(t, "/preview", { contacts: [c("1", "Neha", ["098765 43210"]), c("2", "No Phone", [])] }).expect(200);
      expect(res.body.results[0].state).toBe("NEW");
      expect(res.body.results[0].phones[0]).toBe("+919876543210");
      expect(res.body.results[1].state).toBe("NO_PHONE");
      expect(await prisma.mobileContact.count({ where: { organizationId: a.id } })).toBe(0);
    });

    it("flags duplicates inside a batch", async () => {
      const res = await post(t, "/preview", { contacts: [c("10", "Dup A", ["+91 90000 11111"]), c("11", "Dup B", ["9000011111"])] }).expect(200);
      expect(res.body.results[1].state).toBe("DUPLICATE_IN_BATCH");
      expect(res.body.results[1].duplicateOfIndex).toBe(0);
    });

    it("imports only the fields the user enabled, and never the phone's raw contact id", async () => {
      const res = await post(t, "/import", { fields: ["company"], contacts: [{ ...c("raw-id-777", "Isha", ["9811122233"], { company: "Acme", emails: ["isha@acme.test"] }), decision: "IMPORT" }] }).expect(200);
      expect(res.body.created).toBe(1);
      const row = await prisma.mobileContact.findFirstOrThrow({ where: { organizationId: a.id, displayName: "Isha" } });
      expect(row.company).toBe("Acme");
      expect(row.emails).toEqual([]); // emails were not selected
      expect(row.sourceKeyHash).not.toContain("raw-id-777");
      expect(JSON.stringify(row)).not.toContain("raw-id-777");
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: row.leadId! } });
      expect(lead.ownerId).toBe(a.emp.id);
      expect(lead.organizationId).toBe(a.id);
      expect(lead.email).toBeNull();
    });

    it("is idempotent: re-sending the same contact creates nothing and is reported unchanged", async () => {
      const body = { fields: ["company"], contacts: [{ ...c("raw-id-777", "Isha", ["9811122233"], { company: "Acme" }), decision: "IMPORT" }] };
      const before = await prisma.lead.count({ where: { organizationId: a.id } });
      const res = await post(t, "/import", body).expect(200);
      expect(res.body.unchanged).toBe(1);
      expect(res.body.created).toBe(0);
      expect(await prisma.lead.count({ where: { organizationId: a.id } })).toBe(before);
      const prev = await post(t, "/preview", { fields: ["company"], contacts: [c("raw-id-777", "Isha", ["9811122233"], { company: "Acme" })] }).expect(200);
      expect(prev.body.results[0].state).toBe("UNCHANGED");
      const changed = await post(t, "/preview", { fields: ["company"], contacts: [c("raw-id-777", "Isha", ["9811122233"], { company: "Acme Ltd" })] }).expect(200);
      expect(changed.body.results[0].state).toBe("CHANGED");
    });

    it("detects an existing visible lead and refuses to import a duplicate", async () => {
      await prisma.lead.create({ data: { organizationId: a.id, fullName: "Existing Lead", phone: "919822233344", ownerId: a.emp.id, createdById: a.emp.id } });
      const prev = await post(t, "/preview", { contacts: [c("20", "Whoever", ["9822233344"])] }).expect(200);
      expect(prev.body.results[0].state).toBe("DUPLICATE_LEAD");
      expect(prev.body.results[0].matchLeadName).toBe("Existing Lead");
      const imp = await post(t, "/import", { fields: [], contacts: [{ ...c("20", "Whoever", ["9822233344"]), decision: "IMPORT" }] }).expect(200);
      expect(imp.body.created).toBe(0);
      expect(imp.body.results[0].code).toBe("DUPLICATE_LEAD");
    });

    it("role-based visibility: a duplicate owned outside the user's scope is reported as hidden, with no name or id", async () => {
      await prisma.lead.create({ data: { organizationId: a.id, fullName: "Colleague Secret", phone: "919833344455", ownerId: a.emp2.id, createdById: a.emp2.id } });
      const prev = await post(t, "/preview", { contacts: [c("30", "X", ["9833344455"])] }).expect(200);
      expect(prev.body.results[0].state).toBe("DUPLICATE_HIDDEN");
      expect(JSON.stringify(prev.body)).not.toContain("Colleague Secret");
      const imp = await post(t, "/import", { fields: [], contacts: [{ ...c("30", "X", ["9833344455"]), decision: "IMPORT" }] }).expect(200);
      expect(imp.body.created).toBe(0);
      // The company admin (org-wide) does see it.
      const adminPrev = await post(adminTok, "/preview", { contacts: [c("30", "X", ["9833344455"])] }).expect(200);
      expect(adminPrev.body.results[0].state).toBe("DUPLICATE_LEAD");
    });

    it("tenant isolation: LINK to another organization's lead is rejected; other orgs' leads never match", async () => {
      const foreign = await prisma.lead.create({ data: { organizationId: b.id, fullName: "B Lead", phone: "919844455566", ownerId: b.emp.id, createdById: b.emp.id } });
      const link = await post(t, "/import", { fields: [], contacts: [{ ...c("40", "Link", ["9844455566"]), decision: "LINK", linkLeadId: foreign.id }] }).expect(200);
      expect(link.body.results[0].code).toBe("LEAD_NOT_ACCESSIBLE");
      const prev = await post(t, "/preview", { contacts: [c("40", "Link", ["9844455566"])] }).expect(200);
      expect(prev.body.results[0].state).toBe("NEW");
    });

    it("ignores organization/employee ids supplied by the phone", async () => {
      const res = await post(t, "/import", { fields: [], organizationId: b.id, employeeId: b.emp.id, contacts: [{ ...c("50", "Spoof", ["9855566677"]), decision: "IMPORT" }] });
      expect(res.status).toBe(400); // forbidNonWhitelisted rejects the unknown properties
      const ok = await post(t, "/import", { fields: [], contacts: [{ ...c("50", "Spoof", ["9855566677"]), decision: "IMPORT" }] }).expect(200);
      const row = await prisma.mobileContact.findFirstOrThrow({ where: { displayName: "Spoof" } });
      expect(row.organizationId).toBe(a.id);
      expect(row.employeeId).toBe(a.emp.id);
      expect(ok.body.created).toBe(1);
    });

    it("SKIP stores only the decision, not the person", async () => {
      await post(t, "/import", { fields: ["company", "emails"], contacts: [{ ...c("60", "Private Person", ["9866677788"], { company: "Hush" }), decision: "SKIP" }] }).expect(200);
      const row = await prisma.mobileContact.findFirstOrThrow({ where: { organizationId: a.id, status: "SKIPPED" } });
      expect(row.displayName).toBe("(skipped)");
      expect(row.phoneLast10).toEqual([]);
      expect(row.company).toBeNull();
    });

    it("lists only the caller's own contacts, with cursor pagination", async () => {
      const mine = await request(server()).get("/api/v1/mobile/contacts?limit=1").set(auth(t)).expect(200);
      expect(mine.body.items).toHaveLength(1);
      expect(mine.body.nextCursor).toBeTruthy();
      const page2 = await request(server()).get(`/api/v1/mobile/contacts?limit=50&cursor=${mine.body.nextCursor}`).set(auth(t)).expect(200);
      expect(page2.body.items.every((i: { id: string }) => i.id !== mine.body.items[0].id)).toBe(true);
      const bTok = (await login(b.emp.email, INSTALL("b-contacts")).expect(200)).body.accessToken;
      const bList = await request(server()).get("/api/v1/mobile/contacts").set(auth(bTok)).expect(200);
      expect(bList.body.items).toHaveLength(0);
    });

    it("lets the user delete their imported contacts; deletion is audited", async () => {
      const del = await request(server()).delete("/api/v1/mobile/contacts").set(auth(t)).expect(200);
      expect(del.body.deleted).toBeGreaterThan(0);
      expect(await prisma.mobileContact.count({ where: { organizationId: a.id, employeeId: a.emp.id } })).toBe(0);
      expect(await prisma.auditEvent.count({ where: { organizationId: a.id, action: "mobile.contacts_deleted" } })).toBeGreaterThan(0);
    });

    it("rejects oversized batches", async () => {
      const many = Array.from({ length: 201 }, (_, i) => c(String(i), `N${i}`, ["9870000000"]));
      await post(t, "/preview", { contacts: many }).expect(400);
    });
  });

  describe("idempotent writes (Idempotency-Key)", () => {
    let tok: string;
    let leadId: string;
    beforeAll(async () => {
      tok = (await login(a.emp.email, INSTALL("idem")).expect(200)).body.accessToken;
      leadId = (await prisma.lead.create({ data: { organizationId: a.id, fullName: "Idem Lead", phone: "919800000001", ownerId: a.emp.id, createdById: a.emp.id } })).id;
    });
    const note = (key: string | null, body: string, token = tok) => {
      const r = request(server()).post(`/api/v1/leads/${leadId}/notes`).set(auth(token));
      if (key) r.set("Idempotency-Key", key);
      return r.send({ body });
    };

    it("replays the stored response and does not run the handler twice", async () => {
      const key = `note-${stamp}-1`;
      const first = await note(key, "called back").expect(201);
      const second = await note(key, "called back").expect(201);
      expect(second.headers["idempotent-replayed"]).toBe("true");
      expect(second.body.id).toBe(first.body.id);
      expect(await prisma.leadActivity.count({ where: { leadId, type: "NOTE", body: "called back" } })).toBe(1);
    });

    it("without a key, writes are not deduplicated (behaviour unchanged)", async () => {
      await note(null, "plain").expect(201);
      await note(null, "plain").expect(201);
      expect(await prisma.leadActivity.count({ where: { leadId, type: "NOTE", body: "plain" } })).toBe(2);
    });

    it("rejects reusing a key with a different request body", async () => {
      const key = `note-${stamp}-2`;
      await note(key, "one").expect(201);
      const res = await note(key, "two").expect(422);
      expect(res.body.error.message).toMatch(/different request/);
    });

    it("keys are namespaced per device: another phone cannot replay this one's response", async () => {
      const key = `note-${stamp}-3`;
      await note(key, "mine").expect(201);
      const other = (await login(a.emp.email, INSTALL("idem-other")).expect(200)).body.accessToken as string;
      const res = await note(key, "mine", other).expect(201);
      expect(res.headers["idempotent-replayed"]).toBeUndefined();
    });

    it("releases the key when the handler fails, so the retry can succeed", async () => {
      const key = `note-${stamp}-4`;
      const res = await request(server()).post(`/api/v1/leads/${leadId}/notes`).set(auth(tok)).set("Idempotency-Key", key).send({ body: "" });
      expect(res.status).toBeGreaterThanOrEqual(400);
      await note(key, "").catch(() => undefined);
      expect(await prisma.idempotencyRecord.count({ where: { key, statusCode: 0 } })).toBe(0);
    });

    it("rejects a malformed key", async () => {
      await note("x", "bad key").expect(400);
    });

    it("applies to dispositions too: one retry does not double-count the call", async () => {
      const key = `disp-${stamp}-1`;
      const send = () => request(server()).post(`/api/v1/leads/${leadId}/calls/disposition`).set(auth(tok)).set("Idempotency-Key", key).send({ outcome: "NOT_CONNECTED", disposition: "BUSY" });
      await send().expect(201);
      await send().expect(201);
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead.callCount).toBe(1);
    });
  });

  describe("call activity from the app", () => {
    it("records call-initiated as app_observed (no outcome, no duration) and disposition as user_entered", async () => {
      const s = (await login(a.emp.email, INSTALL("calls")).expect(200)).body.accessToken as string;
      const lead = await prisma.lead.create({ data: { organizationId: a.id, fullName: "Call Lead", phone: "919877788899", ownerId: a.emp.id, createdById: a.emp.id } });
      const init = await request(server()).post(`/api/v1/leads/${lead.id}/call-initiated`).set(auth(s)).expect(201);
      expect(init.body.source).toBe("app_observed");
      const act = await prisma.leadActivity.findUniqueOrThrow({ where: { id: init.body.id } });
      expect(act.callOutcome).toBeNull();
      expect(act.callDurationSeconds).toBeNull();
      const fresh = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(fresh.callCount).toBe(0);

      await request(server()).post(`/api/v1/leads/${lead.id}/calls/disposition`).set(auth(s)).send({ outcome: "NOT_CONNECTED", disposition: "NO_ANSWER" }).expect(201);
      const acts = await prisma.leadActivity.findMany({ where: { leadId: lead.id, type: "CALL" } });
      expect(acts.some((x) => (x.metadata as { source?: string })?.source === "user_entered")).toBe(true);
    });

    it("an employee cannot record a call on someone else's lead", async () => {
      const s = (await login(a.emp.email, INSTALL("calls2")).expect(200)).body.accessToken as string;
      const other = await prisma.lead.create({ data: { organizationId: a.id, fullName: "Not Mine", phone: "919888899900", ownerId: a.emp2.id, createdById: a.emp2.id } });
      await request(server()).post(`/api/v1/leads/${other.id}/call-initiated`).set(auth(s)).expect(403);
    });

    it("call-log ingest through an app token is idempotent", async () => {
      const s = (await login(a.emp.email, INSTALL("ingest")).expect(200)).body.accessToken as string;
      const call = { phone_number: "+919899900011", call_type: "MISSED", started_at: new Date().toISOString(), duration_seconds: 0, external_id: `ext-${stamp}` };
      const r1 = await request(server()).post("/api/v1/mobile/calls").set(auth(s)).send(call);
      expect([200, 201]).toContain(r1.status);
      const r2 = await request(server()).post("/api/v1/mobile/calls").set(auth(s)).send(call).expect(200);
      expect(r2.body.duplicate).toBe(true);
    });
  });
});
