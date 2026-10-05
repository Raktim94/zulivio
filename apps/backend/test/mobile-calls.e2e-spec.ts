import { createHash, randomBytes } from "node:crypto";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Role } from "@prisma/client";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { PrismaService } from "../src/prisma/prisma.service";

const stamp = Date.now();

interface Org {
  id: string;
  admin: { id: string; cookie: string };
  employee: { id: string; cookie: string };
  other: { id: string; cookie: string };
}

describe("Mobile call history (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let a: Org;
  let b: Org;
  let deviceA: { id: string; token: string };
  let deviceB: { id: string; token: string };
  const server = () => app.getHttpServer();

  async function makeEmployee(organizationId: string, role: Role, label: string, managerId?: string) {
    const emp = await prisma.employee.create({
      data: {
        organizationId,
        employeeNumber: `${label}-${stamp}`,
        fullName: `${label} person`,
        email: `${label}-${stamp}@e2e.local`,
        passwordHash: "unused",
        role,
        mustChangePassword: false,
        managerId,
      },
    });
    const raw = randomBytes(24).toString("base64url");
    await prisma.session.create({
      data: { employeeId: emp.id, tokenHash: createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    return { id: emp.id, cookie: `ndcrm_session=${raw}` };
  }

  async function makeOrg(label: string): Promise<Org> {
    const org = await prisma.organization.create({ data: { name: `${label} ${stamp}` } });
    return {
      id: org.id,
      admin: await makeEmployee(org.id, Role.COMPANY_ADMIN, `${label}-admin`),
      employee: await makeEmployee(org.id, Role.EMPLOYEE, `${label}-emp`),
      other: await makeEmployee(org.id, Role.EMPLOYEE, `${label}-emp2`),
    };
  }

  async function registerDevice(org: Org, deviceId: string, employeeId = org.employee.id) {
    const res = await request(server())
      .post("/api/v1/mobile/devices")
      .set("Cookie", org.admin.cookie)
      .send({ deviceId, name: `Phone ${deviceId}`, employeeId })
      .expect(201);
    return { id: res.body.id as string, token: res.body.token as string };
  }

  const post = (token: string, path: string, body: unknown) =>
    request(server()).post(`/api/v1/mobile${path}`).set("Authorization", `Bearer ${token}`).send(body as object);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);

    a = await makeOrg("orgA");
    b = await makeOrg("orgB");
    deviceA = await registerDevice(a, "android-a-01");
    deviceB = await registerDevice(b, "android-b-01");
  });

  afterAll(async () => {
    await prisma.mobileCall.deleteMany({});
    await prisma.mobileDevice.deleteMany({});
    await prisma.leadFollowUp.deleteMany({});
    await prisma.leadActivity.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.pipelineStage.deleteMany({});
    await prisma.pipeline.deleteMany({});
    await prisma.auditEvent.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.employee.deleteMany({});
    await prisma.organization.deleteMany({});
    await app.close();
  });

  const call = (over: Record<string, unknown> = {}) => ({
    phone_number: "+919876543210",
    call_type: "outgoing",
    started_at: "2026-10-05T14:30:20+05:30",
    ended_at: "2026-10-05T14:34:42+05:30",
    duration_seconds: 262,
    sim_slot: 1,
    sim_name: "Jio",
    metadata: { source: "macrodroid" },
    ...over,
  });

  describe("authentication", () => {
    it("rejects a missing token with 401 and a structured error", async () => {
      const res = await request(server()).post("/api/v1/mobile/calls").send(call()).expect(401);
      expect(res.body).toEqual({ success: false, error: { code: "INVALID_TOKEN", message: expect.any(String) } });
    });

    it("rejects an unknown token with 401", async () => {
      await post("zlm_not-a-real-token", "/calls", call()).expect(401);
    });

    it("rejects a personal employee API key / session on the device route", async () => {
      await request(server()).post("/api/v1/mobile/calls").set("Cookie", a.admin.cookie).send(call()).expect(401);
    });

    it("stores only a hash of the token", async () => {
      const row = await prisma.mobileDevice.findUnique({ where: { id: deviceA.id } });
      expect(row?.tokenHash).not.toContain(deviceA.token);
      expect(row?.tokenHash).toBe(createHash("sha256").update(deviceA.token).digest("hex"));
    });

    it("blocks a disabled device with 403, and re-enables it", async () => {
      const dev = await registerDevice(a, "android-a-disabled");
      await request(server()).post(`/api/v1/mobile/devices/${dev.id}/status`).set("Cookie", a.admin.cookie).send({ status: "DISABLED" }).expect(200);
      const res = await post(dev.token, "/calls", call()).expect(403);
      expect(res.body.error.code).toBe("DEVICE_DISABLED");
      await request(server()).post(`/api/v1/mobile/devices/${dev.id}/status`).set("Cookie", a.admin.cookie).send({ status: "ACTIVE" }).expect(200);
      await post(dev.token, "/calls", call()).expect(201);
    });

    it("regenerating the token invalidates the old one immediately", async () => {
      const dev = await registerDevice(a, "android-a-rotate");
      const res = await request(server()).post(`/api/v1/mobile/devices/${dev.id}/regenerate-token`).set("Cookie", a.admin.cookie).expect(200);
      await post(dev.token, "/devices/test", {}).expect(401);
      await post(res.body.token, "/devices/test", {}).expect(200);
    });

    it("blocks a device whose employee is no longer active", async () => {
      const emp = await makeEmployee(a.id, Role.EMPLOYEE, "leaver");
      const dev = await registerDevice(a, "android-a-leaver", emp.id);
      await prisma.employee.update({ where: { id: emp.id }, data: { employmentStatus: "SEPARATED" } });
      await post(dev.token, "/devices/test", {}).expect(403);
    });

    it("rejects a device_id that belongs to another device", async () => {
      const res = await post(deviceA.token, "/calls", call({ device_id: "android-b-01" })).expect(403);
      expect(res.body.error.code).toBe("DEVICE_MISMATCH");
    });
  });

  describe("single call", () => {
    it("creates a call (201) and resolves org/employee from the token, ignoring body ids", async () => {
      const res = await post(deviceA.token, "/calls", call({
        device_id: "android-a-01",
        organization_id: b.id,
        employee_id: b.employee.id,
        started_at: "2026-10-05T09:00:00+05:30",
      })).expect(201);
      expect(res.body).toMatchObject({ success: true, status: "created", duplicate: false });
      const row = await prisma.mobileCall.findFirst({ where: { deviceId: deviceA.id, startedAt: new Date("2026-10-05T09:00:00+05:30") } });
      expect(row?.organizationId).toBe(a.id);
      expect(row?.employeeId).toBe(a.employee.id);
      expect(row?.phoneNumberNormalized).toBe("+919876543210");
    });

    it("is idempotent: an identical retry returns 200 duplicate and stores nothing new", async () => {
      const payload = call({ started_at: "2026-10-05T10:00:00+05:30" });
      await post(deviceA.token, "/calls", payload).expect(201);
      const retry = await post(deviceA.token, "/calls", payload).expect(200);
      expect(retry.body).toMatchObject({ success: true, status: "duplicate", duplicate: true });
      expect(await prisma.mobileCall.count({ where: { deviceId: deviceA.id, startedAt: new Date("2026-10-05T10:00:00+05:30") } })).toBe(1);
    });

    it("dedupes on android_call_id even if other fields drift", async () => {
      await post(deviceA.token, "/calls", call({ android_call_id: "cl-77", started_at: "2026-10-05T11:00:00+05:30" })).expect(201);
      const retry = await post(deviceA.token, "/calls", call({ android_call_id: "cl-77", started_at: "2026-10-05T11:00:00+05:30", duration_seconds: 263 })).expect(200);
      expect(retry.body.duplicate).toBe(true);
    });

    it("treats a call re-read from the call log a few seconds off as the same call", async () => {
      await post(deviceA.token, "/calls", call({ phone_number: "9811111111", started_at: "2026-10-05T12:00:00+05:30" })).expect(201);
      const res = await post(deviceA.token, "/calls", call({ phone_number: "+91 98111 11111", android_call_id: "cl-fuzzy", started_at: "2026-10-05T12:00:03+05:30", duration_seconds: 300 })).expect(200);
      expect(res.body.duplicate).toBe(true);
    });

    it.each([
      ["INVALID_PHONE_NUMBER", { phone_number: "call me maybe" }],
      ["INVALID_PHONE_NUMBER", { phone_number: "12" }],
      ["INVALID_CALL_TYPE", { call_type: "voicemail-ish" }],
      ["INVALID_TIMESTAMP", { started_at: "yesterday" }],
      ["INVALID_TIMESTAMP", { started_at: "2026-10-05T14:30:20" }], // no offset
      ["INVALID_TIMESTAMP", { started_at: "1970-01-01T00:00:00Z" }],
      ["INVALID_TIMESTAMP", { ended_at: "2026-10-05T14:00:00+05:30" }], // before start
      ["INVALID_DURATION", { duration_seconds: -5 }],
      ["INVALID_DURATION", { duration_seconds: 1.5 }],
      ["INVALID_METADATA", { metadata: { nested: { a: 1 } } }],
      ["INVALID_METADATA", { metadata: { big: "x".repeat(200), ...Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, 1])) } }],
    ])("returns 422 %s", async (code, over) => {
      const res = await post(deviceA.token, "/calls", call(over)).expect(422);
      expect(res.body).toMatchObject({ success: false, error: { code } });
    });

    it("rejects a non-object body with 400", async () => {
      await post(deviceA.token, "/calls", [1, 2]).expect(400);
    });

    it("accepts Android numeric call types and epoch-millis timestamps", async () => {
      const res = await post(deviceA.token, "/calls", call({ call_type: 3, started_at: Date.parse("2026-10-05T13:00:00+05:30"), ended_at: undefined, duration_seconds: 0 })).expect(201);
      expect(res.body.status).toBe("created");
      const row = await prisma.mobileCall.findFirst({ where: { deviceId: deviceA.id, startedAt: new Date("2026-10-05T13:00:00+05:30") } });
      expect(row?.callType).toBe("MISSED");
    });

    it("strips markup from names and metadata", async () => {
      await post(deviceA.token, "/calls", call({ started_at: "2026-10-05T13:30:00+05:30", contact_name: "<img src=x onerror=alert(1)>Bob", metadata: { note: "<script>x</script>" } })).expect(201);
      const row = await prisma.mobileCall.findFirst({ where: { deviceId: deviceA.id, startedAt: new Date("2026-10-05T13:30:00+05:30") } });
      expect(row?.contactName).not.toMatch(/[<>]/);
      expect(JSON.stringify(row?.metadata)).not.toMatch(/[<>]/);
    });
  });

  describe("bulk", () => {
    it("reports created / duplicates / rejected counts and is retry-safe", async () => {
      const calls = [
        { phone_number: "+919876543210", call_type: "incoming", started_at: "2026-10-04T14:30:20+05:30", duration_seconds: 45 },
        { phone_number: "+919812345678", call_type: "missed", started_at: "2026-10-04T15:00:00+05:30", duration_seconds: 0 },
        { phone_number: "+919812345678", call_type: "missed", started_at: "2026-10-04T15:00:00+05:30", duration_seconds: 0 }, // dup in batch
        { phone_number: "garbage", call_type: "missed", started_at: "2026-10-04T15:00:00+05:30" },
      ];
      const first = await post(deviceA.token, "/calls/bulk", { device_id: "android-a-01", calls }).expect(200);
      expect(first.body).toMatchObject({ received: 4, created: 2, duplicates: 1, rejected: 1, failed: 0 });
      expect(first.body.errors[0]).toMatchObject({ index: 3, code: "INVALID_PHONE_NUMBER" });

      const retry = await post(deviceA.token, "/calls/bulk", { calls }).expect(200);
      expect(retry.body).toMatchObject({ received: 4, created: 0, duplicates: 3, rejected: 1 });
    });

    it("updates last sync and last external call id", async () => {
      await post(deviceA.token, "/calls/bulk", { calls: [
        { phone_number: "+919800000001", call_type: "incoming", started_at: "2026-09-01T10:00:00+05:30", android_call_id: "old-1" },
        { phone_number: "+919800000002", call_type: "incoming", started_at: "2026-09-02T10:00:00+05:30", android_call_id: "old-2" },
      ] }).expect(200);
      const dev = await prisma.mobileDevice.findUnique({ where: { id: deviceA.id } });
      expect(dev?.lastSyncAt).not.toBeNull();
      expect(dev?.lastExternalCallId).toBe("old-2");
    });

    it("rejects an oversized batch with 413 and records an audit event", async () => {
      const calls = Array.from({ length: 501 }, (_, i) => ({ phone_number: "+919800000099", call_type: "incoming", started_at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString() }));
      const res = await post(deviceA.token, "/calls/bulk", { calls }).expect(413);
      expect(res.body.error.code).toBe("BATCH_TOO_LARGE");
      expect(await prisma.auditEvent.count({ where: { organizationId: a.id, action: "mobile.sync_rejected" } })).toBeGreaterThan(0);
    });

    it("rejects empty and non-array calls with 422", async () => {
      await post(deviceA.token, "/calls/bulk", { calls: [] }).expect(422);
      await post(deviceA.token, "/calls/bulk", { calls: "nope" }).expect(422);
    });

    it("audits a synchronization", async () => {
      expect(await prisma.auditEvent.count({ where: { organizationId: a.id, action: "mobile.sync" } })).toBeGreaterThan(0);
    });
  });

  describe("lead matching", () => {
    it("links a call to the org's lead by number, never to another org's lead", async () => {
      const lead = await prisma.lead.create({ data: { organizationId: a.id, fullName: "Rahul Sharma", phone: "9876501234", createdById: a.admin.id } });
      await prisma.lead.create({ data: { organizationId: b.id, fullName: "Foreign Lead", phone: "9876505678", createdById: b.admin.id } });

      await post(deviceA.token, "/calls", call({ phone_number: "+919876501234", started_at: "2026-10-03T10:00:00+05:30" })).expect(201);
      await post(deviceA.token, "/calls", call({ phone_number: "+919876505678", started_at: "2026-10-03T11:00:00+05:30" })).expect(201);

      const matched = await prisma.mobileCall.findFirst({ where: { deviceId: deviceA.id, phoneLast10: "9876501234" } });
      const foreign = await prisma.mobileCall.findFirst({ where: { deviceId: deviceA.id, phoneLast10: "9876505678" } });
      expect(matched?.leadId).toBe(lead.id);
      expect(foreign?.leadId).toBeNull(); // unknown number: stays unassigned, no lead auto-created
      expect(await prisma.lead.count({ where: { organizationId: a.id } })).toBe(1);
    });

    it("attaches an unassigned call (and same-number calls) to an existing lead, and can create a lead", async () => {
      const list = await request(server()).get("/api/v1/mobile/calls?phone_number=9876505678&unassigned=true").set("Cookie", a.admin.cookie).expect(200);
      expect(list.body.items).toHaveLength(1);
      const id = list.body.items[0].id as string;

      const created = await request(server()).post(`/api/v1/mobile/calls/${id}/create-lead`).set("Cookie", a.admin.cookie).send({ fullName: "New Caller" }).expect(201);
      const detail = await request(server()).get(`/api/v1/mobile/calls/${id}`).set("Cookie", a.admin.cookie).expect(200);
      expect(detail.body.lead.id).toBe(created.body.leadId);

      const foreignLead = await prisma.lead.findFirst({ where: { organizationId: b.id } });
      await request(server()).post(`/api/v1/mobile/calls/${id}/attach`).set("Cookie", a.admin.cookie).send({ leadId: foreignLead!.id }).expect(404);
    });
  });

  describe("tenant isolation", () => {
    let callOfA: string;
    beforeAll(async () => {
      const row = await prisma.mobileCall.findFirst({ where: { organizationId: a.id } });
      callOfA = row!.id;
      await post(deviceB.token, "/calls", call({ started_at: "2026-10-05T08:00:00+05:30" })).expect(201);
    });

    it("org B's admin cannot read, list, delete or attach org A's calls", async () => {
      await request(server()).get(`/api/v1/mobile/calls/${callOfA}`).set("Cookie", b.admin.cookie).expect(404);
      await request(server()).delete(`/api/v1/mobile/calls/${callOfA}`).set("Cookie", b.admin.cookie).expect(404);
      const list = await request(server()).get("/api/v1/mobile/calls?limit=100").set("Cookie", b.admin.cookie).expect(200);
      expect(list.body.items.length).toBe(1);
      const ids = list.body.items.map((i: { id: string }) => i.id);
      expect(ids).not.toContain(callOfA);
      expect(await prisma.mobileCall.count({ where: { id: callOfA } })).toBe(1);
    });

    it("org B cannot see, modify or revoke org A's devices", async () => {
      const list = await request(server()).get("/api/v1/mobile/devices").set("Cookie", b.admin.cookie).expect(200);
      expect(list.body.map((d: { id: string }) => d.id)).not.toContain(deviceA.id);
      await request(server()).post(`/api/v1/mobile/devices/${deviceA.id}/regenerate-token`).set("Cookie", b.admin.cookie).expect(404);
      await request(server()).post(`/api/v1/mobile/devices/${deviceA.id}/status`).set("Cookie", b.admin.cookie).send({ status: "DISABLED" }).expect(404);
      await request(server()).delete(`/api/v1/mobile/devices/${deviceA.id}`).set("Cookie", b.admin.cookie).expect(404);
      await request(server()).post(`/api/v1/mobile/devices/${deviceA.id}/import`).set("Cookie", b.admin.cookie).send({ calls: [] }).expect(404);
    });

    it("cannot register a device for another org's employee", async () => {
      await request(server()).post("/api/v1/mobile/devices").set("Cookie", b.admin.cookie).send({ deviceId: "xorg-1", name: "x", employeeId: a.employee.id }).expect(404);
    });

    it("the same call from two orgs' devices never collides", async () => {
      expect(await prisma.mobileCall.count({ where: { organizationId: b.id } })).toBe(1);
    });

    it("org B's summary only counts its own calls", async () => {
      const res = await request(server()).get("/api/v1/mobile/calls/summary").set("Cookie", b.admin.cookie).expect(200);
      expect(res.body.employees).toHaveLength(1);
      expect(res.body.employees[0].totalCalls).toBe(1);
    });
  });

  describe("authorization and reading", () => {
    it("requires a session for admin routes", async () => {
      await request(server()).get("/api/v1/mobile/calls").expect(401);
    });

    it("employees see only their own calls; others' calls are 404", async () => {
      const otherDev = await registerDevice(a, "android-a-other", a.other.id);
      await post(otherDev.token, "/calls", call({ phone_number: "+919700000000", started_at: "2026-10-02T10:00:00+05:30" })).expect(201);
      const otherCall = await prisma.mobileCall.findFirst({ where: { deviceId: otherDev.id } });

      const mine = await request(server()).get("/api/v1/mobile/calls?limit=100").set("Cookie", a.employee.cookie).expect(200);
      expect(mine.body.items.every((i: { employee: { id: string } }) => i.employee.id === a.employee.id)).toBe(true);
      await request(server()).get(`/api/v1/mobile/calls/${otherCall!.id}`).set("Cookie", a.employee.cookie).expect(404);
      await request(server()).get(`/api/v1/mobile/calls?employee_id=${a.other.id}`).set("Cookie", a.employee.cookie).expect(403);
    });

    it("employees cannot manage devices, delete calls, or change retention", async () => {
      await request(server()).get("/api/v1/mobile/devices").set("Cookie", a.employee.cookie).expect(403);
      await request(server()).post("/api/v1/mobile/devices").set("Cookie", a.employee.cookie).send({ deviceId: "nope-1", name: "n", employeeId: a.employee.id }).expect(403);
      await request(server()).delete("/api/v1/mobile/calls?employee_id=" + a.employee.id).set("Cookie", a.employee.cookie).expect(403);
      await request(server()).patch("/api/v1/mobile/settings").set("Cookie", a.employee.cookie).send({ callRetentionDays: 90 }).expect(403);
    });

    it("an admin sees calls org-wide with employee assignment, and detail includes metadata", async () => {
      const res = await request(server()).get("/api/v1/mobile/calls?limit=100").set("Cookie", a.admin.cookie).expect(200);
      const employees = new Set(res.body.items.map((i: { employee: { id: string } }) => i.employee.id));
      expect(employees.has(a.employee.id) && employees.has(a.other.id)).toBe(true);
      const detail = await request(server()).get(`/api/v1/mobile/calls/${res.body.items[0].id}`).set("Cookie", a.admin.cookie).expect(200);
      expect(detail.body).toHaveProperty("metadata");
      expect(res.body.items[0]).not.toHaveProperty("metadata"); // list stays minimal
    });

    it("filters by type, phone, date range, duration, device and paginates", async () => {
      const get = (qs: string) => request(server()).get(`/api/v1/mobile/calls?${qs}`).set("Cookie", a.admin.cookie).expect(200);

      const missed = await get("call_type=missed&limit=100");
      expect(missed.body.items.length).toBeGreaterThan(0);
      expect(missed.body.items.every((i: { callType: string }) => i.callType === "missed")).toBe(true);

      const byPhone = await get("phone_number=%2B919812345678");
      expect(byPhone.body.items.every((i: { phoneNumberNormalized: string }) => i.phoneNumberNormalized === "+919812345678")).toBe(true);

      const day = await get("from=2026-10-04T00:00:00%2B05:30&to=2026-10-04T23:59:59%2B05:30&limit=100");
      expect(day.body.items.length).toBe(2);

      const long = await get("min_duration=250&limit=100");
      expect(long.body.items.every((i: { durationSeconds: number }) => i.durationSeconds >= 250)).toBe(true);

      const dev = await get(`device_id=${deviceA.id}&limit=100`);
      expect(dev.body.total).toBeGreaterThan(5);

      const p1 = await get("limit=3&page=1");
      const p2 = await get("limit=3&page=2");
      expect(p1.body.items).toHaveLength(3);
      expect(p2.body.items.map((i: { id: string }) => i.id)).not.toEqual(expect.arrayContaining([p1.body.items[0].id]));
      expect(p1.body.total).toBe(p2.body.total);
      await request(server()).get("/api/v1/mobile/calls?limit=1000").set("Cookie", a.admin.cookie).expect(400);
      await request(server()).get("/api/v1/mobile/calls?call_type=bogus").set("Cookie", a.admin.cookie).expect(400);
    });

    it("summarises per-employee activity", async () => {
      const res = await request(server()).get("/api/v1/mobile/calls/summary").set("Cookie", a.admin.cookie).expect(200);
      const row = res.body.employees.find((e: { employeeId: string }) => e.employeeId === a.employee.id);
      expect(row.outgoing).toBeGreaterThan(0);
      expect(row.totalDurationSeconds).toBeGreaterThan(0);
    });
  });

  describe("test endpoint", () => {
    it("confirms the connection, updates last seen, and does not create call records", async () => {
      const before = await prisma.mobileCall.count({ where: { organizationId: a.id } });
      const res = await post(deviceA.token, "/devices/test", { device_id: "android-a-01" }).expect(200);
      expect(res.body).toMatchObject({ success: true, message: "Connected successfully", device: { id: "android-a-01" } });
      expect(await prisma.mobileCall.count({ where: { organizationId: a.id } })).toBe(before);
      const dev = await prisma.mobileDevice.findUnique({ where: { id: deviceA.id } });
      expect(dev?.lastTestAt).not.toBeNull();
      expect(dev?.lastSeenAt).not.toBeNull();
    });
  });

  describe("privacy controls", () => {
    it("deletes device data and the device on request, with audit trail", async () => {
      const dev = await registerDevice(a, "android-a-delete");
      await post(dev.token, "/calls", call({ started_at: "2026-10-01T10:00:00+05:30" })).expect(201);
      const cleared = await request(server()).delete(`/api/v1/mobile/devices/${dev.id}/calls`).set("Cookie", a.admin.cookie).expect(200);
      expect(cleared.body.deleted).toBe(1);
      await request(server()).delete(`/api/v1/mobile/devices/${dev.id}`).set("Cookie", a.admin.cookie).expect(200);
      await post(dev.token, "/devices/test", {}).expect(401);
      expect(await prisma.auditEvent.count({ where: { organizationId: a.id, action: "mobile_device.removed" } })).toBe(1);
    });

    it("refuses an unfiltered bulk delete and sets retention", async () => {
      await request(server()).delete("/api/v1/mobile/calls").set("Cookie", a.admin.cookie).expect(400);
      await request(server()).patch("/api/v1/mobile/settings").set("Cookie", a.admin.cookie).send({ callRetentionDays: 10 }).expect(400);
      await request(server()).patch("/api/v1/mobile/settings").set("Cookie", a.admin.cookie).send({ callRetentionDays: 365 }).expect(200);
    });

    it("never returns the token after creation", async () => {
      const list = await request(server()).get("/api/v1/mobile/devices").set("Cookie", a.admin.cookie).expect(200);
      expect(JSON.stringify(list.body)).not.toContain(deviceA.token);
      expect(list.body[0]).not.toHaveProperty("token");
      expect(list.body[0]).not.toHaveProperty("tokenHash");
    });

    it("audits device lifecycle events", async () => {
      const actions = (await prisma.auditEvent.findMany({ where: { organizationId: a.id }, select: { action: true } })).map((e) => e.action);
      expect(actions).toEqual(expect.arrayContaining(["mobile_device.created", "mobile_device.token_generated", "mobile_device.token_regenerated", "mobile_device.disabled"]));
    });
  });

  describe("admin history import", () => {
    it("back-fills old history through the same dedupe path", async () => {
      const calls = Array.from({ length: 300 }, (_, i) => ({
        phone_number: `+9199000${String(10000 + i)}`,
        call_type: i % 3 === 0 ? 3 : 1,
        started_at: new Date(Date.UTC(2025, 0, 1) + i * 3_600_000).toISOString(),
        duration_seconds: i,
      }));
      const first = await request(server()).post(`/api/v1/mobile/devices/${deviceA.id}/import`).set("Cookie", a.admin.cookie).send({ calls }).expect(200);
      expect(first.body).toMatchObject({ received: 300, created: 300, duplicates: 0 });
      const again = await request(server()).post(`/api/v1/mobile/devices/${deviceA.id}/import`).set("Cookie", a.admin.cookie).send({ calls }).expect(200);
      expect(again.body).toMatchObject({ created: 0, duplicates: 300 });
      expect(await prisma.auditEvent.count({ where: { organizationId: a.id, action: "mobile.import_large" } })).toBeGreaterThan(0);
    });
  });

  describe("rate limiting", () => {
    it("returns 429 once a device exceeds its request budget", async () => {
      const dev = await registerDevice(b, "android-b-ratelimit");
      let limited = 0;
      for (let i = 0; i < 125; i++) {
        const res = await post(dev.token, "/devices/test", {});
        if (res.status === 429) {
          limited++;
          expect(res.body.error.code).toBe("RATE_LIMITED");
        }
      }
      expect(limited).toBeGreaterThan(0);
    });
  });
});
