import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

/**
 * Covers the telecalling CRM feature set, and — just as importantly — pins
 * the backward compatibility of the endpoints an external integration
 * (Submify) already calls in production. The "backward compatibility"
 * describe block is a regression guard: if a future change drops a field
 * from POST /api/v1/leads or wraps GET /api/v1/leads in an envelope, those
 * tests fail before it ships.
 */
describe("Telecalling CRM (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const ownerEmail = `crm-owner-${stamp}@e2e.local`;
  const ownerPassword = "SuperSecret123!";

  const server = () => app.getHttpServer();
  const ownerAgent = () => request.agent(server());
  type Agent = ReturnType<typeof ownerAgent>;

  let owner: Agent;
  let manager: Agent;
  let rep: Agent;
  let otherRep: Agent;

  let managerId: string;
  let repId: string;
  let otherRepId: string;
  let repTempPassword: string;
  let repEmail: string;

  let leadStages: { id: string; name: string; sortOrder: number; isLost: boolean }[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await request(server())
      .post("/api/v1/bootstrap")
      .send({
        organizationName: `CRM Org ${stamp}`,
        fullName: "CRM Owner",
        email: ownerEmail,
        password: ownerPassword,
      })
      .expect(201);

    owner = ownerAgent();
    await owner.post("/api/v1/auth/sessions").send({ email: ownerEmail, password: ownerPassword }).expect(201);

    const managerEmail = `crm-manager-${stamp}@e2e.local`;
    const managerRes = await owner
      .post("/api/v1/employees")
      .send({ fullName: "CRM Manager", email: managerEmail, role: "MANAGER" })
      .expect(201);
    managerId = managerRes.body.id;

    manager = ownerAgent();
    await manager
      .post("/api/v1/auth/sessions")
      .send({ email: managerEmail, password: managerRes.body.temporaryPassword })
      .expect(201);
    await manager
      .post("/api/v1/auth/change-password")
      .send({ currentPassword: managerRes.body.temporaryPassword, newPassword: "ManagerPass123!" })
      .expect(201);
    manager = ownerAgent();
    await manager
      .post("/api/v1/auth/sessions")
      .send({ email: managerEmail, password: "ManagerPass123!" })
      .expect(201);

    // The rep reports to the manager, so manager scoping has something real to resolve.
    repEmail = `crm-rep-${stamp}@e2e.local`;
    const repRes = await owner
      .post("/api/v1/employees")
      .send({ fullName: "CRM Rep", email: repEmail, role: "EMPLOYEE", managerId })
      .expect(201);
    repId = repRes.body.id;
    repTempPassword = repRes.body.temporaryPassword;

    const otherEmail = `crm-other-${stamp}@e2e.local`;
    const otherRes = await owner
      .post("/api/v1/employees")
      .send({ fullName: "Unrelated Rep", email: otherEmail, role: "EMPLOYEE" })
      .expect(201);
    otherRepId = otherRes.body.id;
    otherRep = ownerAgent();
    await otherRep
      .post("/api/v1/auth/sessions")
      .send({ email: otherEmail, password: otherRes.body.temporaryPassword })
      .expect(201);

    const stagesRes = await owner.get("/api/v1/pipelines?kind=LEAD").expect(200);
    leadStages = stagesRes.body[0].stages;
  });

  afterAll(async () => {
    await prisma.leadActivity.deleteMany({});
    await prisma.leadFollowUp.deleteMany({});
    await prisma.forecastAdjustment.deleteMany({});
    await prisma.opportunityEvent.deleteMany({});
    await prisma.opportunity.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.leadScoreConfig.deleteMany({});
    await prisma.pipelineStage.deleteMany({});
    await prisma.pipeline.deleteMany({});
    await prisma.assignmentRule.deleteMany({});
    await prisma.auditEvent.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.employee.deleteMany({});
    await prisma.organization.deleteMany({});
    await app.close();
  });

  // -------------------------------------------------------------------
  // Auth — the pre-existing temp-password flow, confirmed rather than
  // assumed (the CRM work reuses it as-is and rebuilt nothing).
  // -------------------------------------------------------------------

  describe("temporary password and forced change", () => {
    it("reports mustChangePassword on a first login with the temporary password", async () => {
      const agent = ownerAgent();
      const res = await agent
        .post("/api/v1/auth/sessions")
        .send({ email: repEmail, password: repTempPassword })
        .expect(201);

      expect(res.body.employee.mustChangePassword).toBe(true);
    });

    it("rejects the temporary password once it has been changed, and accepts the new one", async () => {
      const agent = ownerAgent();
      await agent.post("/api/v1/auth/sessions").send({ email: repEmail, password: repTempPassword }).expect(201);
      await agent
        .post("/api/v1/auth/change-password")
        .send({ currentPassword: repTempPassword, newPassword: "RepPass123!" })
        .expect(201);

      await request(server())
        .post("/api/v1/auth/sessions")
        .send({ email: repEmail, password: repTempPassword })
        .expect(401);

      const res = await request(server())
        .post("/api/v1/auth/sessions")
        .send({ email: repEmail, password: "RepPass123!" })
        .expect(201);
      expect(res.body.employee.mustChangePassword).toBe(false);

      rep = ownerAgent();
      await rep.post("/api/v1/auth/sessions").send({ email: repEmail, password: "RepPass123!" }).expect(201);
    });

    it("blocks unauthenticated access to CRM endpoints and clears the session on logout", async () => {
      await request(server()).get("/api/v1/leads").expect(401);
      await request(server()).get("/api/v1/follow-ups").expect(401);

      const agent = ownerAgent();
      await agent.post("/api/v1/auth/sessions").send({ email: repEmail, password: "RepPass123!" }).expect(201);
      await agent.get("/api/v1/leads").expect(200);
      await agent.post("/api/v1/auth/sessions/logout").expect(201);
      await agent.get("/api/v1/leads").expect(401);
    });

    it("re-arms mustChangePassword when an admin resets a password", async () => {
      const resetRes = await owner.post(`/api/v1/employees/${otherRepId}/reset-password`).expect(201);
      const res = await request(server())
        .post("/api/v1/auth/sessions")
        .send({
          email: `crm-other-${stamp}@e2e.local`,
          password: resetRes.body.temporaryPassword,
        })
        .expect(201);
      expect(res.body.employee.mustChangePassword).toBe(true);

      otherRep = ownerAgent();
      await otherRep
        .post("/api/v1/auth/sessions")
        .send({ email: `crm-other-${stamp}@e2e.local`, password: resetRes.body.temporaryPassword })
        .expect(201);
    });
  });

  // -------------------------------------------------------------------
  // Backward compatibility — the live-integration guard.
  // -------------------------------------------------------------------

  describe("backward compatibility of the pre-existing lead API", () => {
    it("accepts the original POST /api/v1/leads body and returns every original field", async () => {
      const res = await owner
        .post("/api/v1/leads")
        .send({
          fullName: "Legacy Payload Lead",
          email: "legacy@example.com",
          phone: "+919000000001",
          company: "Legacy Co",
          source: "submify",
          notes: "created by an external integration",
          territory: "north",
          autoAssign: false,
        })
        .expect(201);

      // Every field the pre-telecalling response carried, still present and
      // still the same type.
      for (const key of [
        "id",
        "organizationId",
        "fullName",
        "email",
        "phone",
        "company",
        "source",
        "status",
        "ownerId",
        "createdById",
        "notes",
        "territory",
        "respondBySlaAt",
        "firstRespondedAt",
        "convertedOpportunityId",
        "createdAt",
        "updatedAt",
      ]) {
        expect(res.body).toHaveProperty(key);
      }
      expect(res.body.status).toBe("NEW");
      expect(res.body.fullName).toBe("Legacy Payload Lead");
      expect(res.body.source).toBe("submify");
      expect(res.body.territory).toBe("north");
    });

    it("still returns a bare array from GET /api/v1/leads, not a paginated envelope", async () => {
      const res = await owner.get("/api/v1/leads").expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it("still honours the original ?status= and ?overdue= filters", async () => {
      const res = await owner.get("/api/v1/leads?status=NEW").expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.every((l: { status: string }) => l.status === "NEW")).toBe(true);

      await owner.get("/api/v1/leads?overdue=true").expect(200);
    });

    it("still enforces the original lead status state machine on PATCH /api/v1/leads/:id", async () => {
      const created = await owner.post("/api/v1/leads").send({ fullName: "State Machine Lead" }).expect(201);
      await owner.patch(`/api/v1/leads/${created.body.id}`).send({ status: "CONTACTED" }).expect(200);
      // CONTACTED cannot go back to NEW.
      await owner.patch(`/api/v1/leads/${created.body.id}`).send({ status: "NEW" }).expect(400);
    });

    it("keeps GET /api/v1/pipelines returning only the opportunity pipeline", async () => {
      const res = await owner.get("/api/v1/pipelines").expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].isDefault).toBe(true);
      expect(res.body[0].stages.map((s: { name: string }) => s.name)).toEqual([
        "New",
        "Qualified",
        "Proposal",
        "Negotiation",
        "Won",
        "Lost",
      ]);
    });

    it("rejects an unknown field, so the additive DTOs did not loosen validation", async () => {
      await owner.post("/api/v1/leads").send({ fullName: "Nope", notAField: true }).expect(400);
    });
  });

  // -------------------------------------------------------------------
  // The telecalling loop.
  // -------------------------------------------------------------------

  describe("lead workspace, stages, qualification and scoring", () => {
    let leadId: string;

    it("creates a lead with the new optional fields and places it on the board's first stage", async () => {
      const res = await owner
        .post("/api/v1/leads")
        .send({
          fullName: "Priya Nair",
          phone: "+919000000002",
          company: "Nair Textiles",
          source: "website",
          jobTitle: "Head of Ops",
          website: "nairtextiles.example.com",
          campaign: "diwali-2026",
          tags: ["inbound", "textiles"],
          priority: "HIGH",
          ownerId: repId,
        })
        .expect(201);

      leadId = res.body.id;
      expect(res.body.priority).toBe("HIGH");
      expect(res.body.tags).toEqual(["inbound", "textiles"]);
      expect(res.body.stageId).toBe(leadStages[0].id);
      expect(res.body.score).toBe(0);
    });

    it("returns the whole workspace payload in one request", async () => {
      const res = await rep.get(`/api/v1/leads/${leadId}/detail`).expect(200);
      expect(res.body.lead.id).toBe(leadId);
      expect(Array.isArray(res.body.activities)).toBe(true);
      expect(Array.isArray(res.body.followUps)).toBe(true);
      expect(res.body.stages.length).toBe(leadStages.length);
      expect(res.body.scoreBand).toBe("COLD");
      expect(res.body.scoreBreakdown).toHaveLength(6);
      expect(res.body.dialUri).toBe("tel:+919000000002");
    });

    it("scores a lead from the org's configured weights and bands it", async () => {
      const res = await rep
        .patch(`/api/v1/leads/${leadId}/qualification`)
        .send({
          budgetMinor: 5_000_00,
          timelineDays: 14,
          isDecisionMaker: true,
          requirement: "200 units per month, delivered weekly",
          requirementUrgent: true,
          businessType: "Manufacturing",
          existingSolution: "Spreadsheets",
          purchaseIntent: "HIGH",
          goodBusinessFit: true,
        })
        .expect(200);

      // 25 budget + 20 decision maker + 20 urgent + 15 clear + 10 timeline + 10 fit = 100
      expect(res.body.score).toBe(100);
      expect(res.body.band).toBe("HOT");
    });

    it("recomputes the score when the weights change, instead of using a hardcoded formula", async () => {
      await owner
        .patch("/api/v1/leads/score-config")
        .send({ budgetAvailableWeight: 5, decisionMakerWeight: 5 })
        .expect(200);

      const res = await rep
        .patch(`/api/v1/leads/${leadId}/qualification`)
        .send({ goodBusinessFit: true })
        .expect(200);

      // 5 + 5 + 20 + 15 + 10 + 10 = 65 → WARM
      expect(res.body.score).toBe(65);
      expect(res.body.band).toBe("WARM");

      // Restore the defaults so later assertions read against the documented weights.
      await owner
        .patch("/api/v1/leads/score-config")
        .send({ budgetAvailableWeight: 25, decisionMakerWeight: 20 })
        .expect(200);
    });

    it("blocks a stage that needs qualification the lead does not have", async () => {
      const bare = await owner.post("/api/v1/leads").send({ fullName: "Unqualified Lead", ownerId: repId }).expect(201);
      const qualified = leadStages.find((s) => s.name === "Qualified")!;

      const res = await rep.patch(`/api/v1/leads/${bare.body.id}/stage`).send({ stageId: qualified.id }).expect(400);
      // This spec does not register AllExceptionsFilter, so the body is
      // Nest's default { statusCode, message, error } shape.
      expect(String(res.body.message)).toContain("qualification fields");
    });

    it("accepts the missing qualification alongside the drop, in one action", async () => {
      const bare = await owner.post("/api/v1/leads").send({ fullName: "Modal Lead", ownerId: repId }).expect(201);
      const qualified = leadStages.find((s) => s.name === "Qualified")!;

      const res = await rep
        .patch(`/api/v1/leads/${bare.body.id}/stage`)
        .send({
          stageId: qualified.id,
          qualification: { budgetMinor: 100_00, timelineDays: 10, requirement: "Trial order" },
        })
        .expect(200);

      expect(res.body.stageId).toBe(qualified.id);
      expect(res.body.status).toBe("QUALIFIED");
      expect(res.body.qualifiedAt).not.toBeNull();
    });

    it("derives the coarse status from the stage and allows moving backwards on the board", async () => {
      const interested = leadStages.find((s) => s.name === "Interested")!;
      const contacted = leadStages.find((s) => s.name === "Contacted")!;

      let res = await rep.patch(`/api/v1/leads/${leadId}/stage`).send({ stageId: interested.id }).expect(200);
      expect(res.body.status).toBe("CONTACTED");

      // The forward-only status state machine would reject this; a board must allow it.
      res = await rep.patch(`/api/v1/leads/${leadId}/stage`).send({ stageId: contacted.id }).expect(200);
      expect(res.body.stageId).toBe(contacted.id);
    });

    it("requires a granular loss reason when moving to a loss stage", async () => {
      const lost = leadStages.find((s) => s.isLost)!;
      const doomed = await owner.post("/api/v1/leads").send({ fullName: "Doomed Lead", ownerId: repId }).expect(201);

      await rep.patch(`/api/v1/leads/${doomed.body.id}/stage`).send({ stageId: lost.id }).expect(400);

      const res = await rep
        .patch(`/api/v1/leads/${doomed.body.id}/stage`)
        .send({ stageId: lost.id, lossReason: "NO_BUDGET", lossNotes: "Budget cut this quarter" })
        .expect(200);

      expect(res.body.status).toBe("DISQUALIFIED");
      expect(res.body.lossReason).toBe("NO_BUDGET");
    });

    it("writes a stage change to the timeline and to the audit log", async () => {
      const activities = await rep.get(`/api/v1/leads/${leadId}/activities`).expect(200);
      expect(activities.body.some((a: { type: string }) => a.type === "STAGE_CHANGE")).toBe(true);
      expect(activities.body.some((a: { type: string }) => a.type === "QUALIFICATION_UPDATED")).toBe(true);

      const audit = await owner.get("/api/v1/audit-events").expect(200);
      expect(audit.body.some((e: { action: string }) => e.action === "lead.stage_changed")).toBe(true);
      expect(audit.body.some((e: { action: string }) => e.action === "lead.qualification_changed")).toBe(true);
    });

    it("records a note on the timeline", async () => {
      await rep.post(`/api/v1/leads/${leadId}/notes`).send({ body: "Asked for a callback after 6pm" }).expect(201);
      const res = await rep.get(`/api/v1/leads/${leadId}/activities`).expect(200);
      expect(res.body[0].type).toBe("NOTE");
      expect(res.body[0].body).toBe("Asked for a callback after 6pm");
    });
  });

  describe("calling and disposition", () => {
    let leadId: string;

    beforeAll(async () => {
      const res = await owner
        .post("/api/v1/leads")
        .send({ fullName: "Call Target", phone: "+91 90000 00003", ownerId: repId })
        .expect(201);
      leadId = res.body.id;
    });

    it("hands back a dialable URI from the swappable calling provider", async () => {
      const res = await rep.post(`/api/v1/leads/${leadId}/calls`).expect(201);
      expect(res.body.provider).toBe("manual");
      expect(res.body.mode).toBe("manual");
      expect(res.body.dialUri).toBe("tel:+919000000003");
    });

    it("records a connected call with its disposition and duration", async () => {
      const res = await rep
        .post(`/api/v1/leads/${leadId}/calls/disposition`)
        .send({ outcome: "CONNECTED", disposition: "INTERESTED", durationSeconds: 145, notes: "Wants a demo" })
        .expect(201);

      const call = res.body.activities.find((a: { type: string }) => a.type === "CALL");
      expect(call.callOutcome).toBe("CONNECTED");
      expect(call.callDisposition).toBe("INTERESTED");
      expect(call.callDurationSeconds).toBe(145);
      expect(res.body.lead.callCount).toBe(1);
      expect(res.body.lead.lastContactedAt).not.toBeNull();
      // INTERESTED implies the Interested stage.
      expect(res.body.lead.stage.name).toBe("Interested");
    });

    it("rejects a disposition that does not belong to the outcome", async () => {
      await rep
        .post(`/api/v1/leads/${leadId}/calls/disposition`)
        .send({ outcome: "NOT_CONNECTED", disposition: "MEETING_BOOKED" })
        .expect(400);
    });

    it("accepts a not-connected disposition and schedules a follow-up in the same call", async () => {
      const dueAt = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
      const res = await rep
        .post(`/api/v1/leads/${leadId}/calls/disposition`)
        .send({
          outcome: "NOT_CONNECTED",
          disposition: "NO_ANSWER",
          followUpAt: dueAt,
          followUpNote: "Try again this evening",
        })
        .expect(201);

      expect(res.body.lead.callCount).toBe(2);
      expect(res.body.followUps).toHaveLength(1);
      expect(res.body.lead.nextFollowUpAt).not.toBeNull();
    });
  });

  describe("follow-ups", () => {
    let leadId: string;
    let followUpId: string;

    beforeAll(async () => {
      const res = await owner
        .post("/api/v1/leads")
        .send({ fullName: "Follow-up Target", phone: "+919000000004", ownerId: repId })
        .expect(201);
      leadId = res.body.id;
    });

    it("schedules a follow-up and mirrors it onto the lead's nextFollowUpAt", async () => {
      const dueAt = new Date(Date.now() - 60 * 60_000).toISOString(); // already overdue
      const res = await rep
        .post(`/api/v1/leads/${leadId}/follow-ups`)
        .send({ dueAt, note: "Overdue on purpose" })
        .expect(201);

      followUpId = res.body.id;
      expect(res.body.status).toBe("PENDING");

      const lead = await rep.get(`/api/v1/leads/${leadId}`).expect(200);
      expect(new Date(lead.body.nextFollowUpAt).toISOString()).toBe(new Date(dueAt).toISOString());
    });

    it("buckets it as overdue on the follow-up dashboard", async () => {
      const res = await rep.get("/api/v1/follow-ups").expect(200);
      expect(res.body.counts.overdue).toBeGreaterThanOrEqual(1);
      expect(res.body.buckets.overdue.some((f: { id: string }) => f.id === followUpId)).toBe(true);
    });

    it("reschedules it into the future, moving it out of the overdue bucket", async () => {
      const dueAt = new Date(Date.now() + 26 * 60 * 60_000).toISOString(); // tomorrow
      await rep.patch(`/api/v1/follow-ups/${followUpId}/reschedule`).send({ dueAt }).expect(200);

      const res = await rep.get("/api/v1/follow-ups").expect(200);
      expect(res.body.buckets.overdue.some((f: { id: string }) => f.id === followUpId)).toBe(false);
      expect(
        [...res.body.buckets.tomorrow, ...res.body.buckets.upcoming].some(
          (f: { id: string }) => f.id === followUpId,
        ),
      ).toBe(true);
    });

    it("completes it, clears nextFollowUpAt and writes a timeline entry", async () => {
      await rep.patch(`/api/v1/follow-ups/${followUpId}/complete`).send({ outcome: "Spoke, sending quote" }).expect(200);

      const lead = await rep.get(`/api/v1/leads/${leadId}`).expect(200);
      expect(lead.body.nextFollowUpAt).toBeNull();

      const activities = await rep.get(`/api/v1/leads/${leadId}/activities`).expect(200);
      expect(activities.body.some((a: { type: string }) => a.type === "FOLLOW_UP_COMPLETED")).toBe(true);
      expect(activities.body.some((a: { type: string }) => a.type === "FOLLOW_UP_RESCHEDULED")).toBe(true);
    });

    it("refuses to complete the same follow-up twice", async () => {
      await rep.patch(`/api/v1/follow-ups/${followUpId}/complete`).send({}).expect(400);
    });

    it("blocks an employee from scheduling a follow-up for someone else", async () => {
      await rep
        .post(`/api/v1/leads/${leadId}/follow-ups`)
        .send({ dueAt: new Date(Date.now() + 60_000).toISOString(), assigneeId: otherRepId })
        .expect(403);
    });
  });

  describe("Call Next Lead", () => {
    it("prefers a lead with an overdue follow-up over everything else", async () => {
      const target = await owner
        .post("/api/v1/leads")
        .send({ fullName: "Overdue Queue Lead", phone: "+919000000005", ownerId: repId })
        .expect(201);

      await rep
        .post(`/api/v1/leads/${target.body.id}/follow-ups`)
        .send({ dueAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() })
        .expect(201);

      const res = await rep.get("/api/v1/leads/next").expect(200);
      expect(res.body.reason).toBe("overdue_follow_up");
      expect(res.body.lead.id).toBe(target.body.id);
    });

    it("returns an empty queue rather than an error when a telecaller owns nothing", async () => {
      const res = await otherRep.get("/api/v1/leads/next").expect(200);
      expect(res.body.reason).toBe("queue_empty");
      expect(res.body.lead).toBeNull();
    });

    it("serves the telecaller dashboard payload", async () => {
      const res = await rep.get("/api/v1/leads/my-day").expect(200);
      expect(Array.isArray(res.body.toContact)).toBe(true);
      expect(Array.isArray(res.body.hotLeads)).toBe(true);
      expect(res.body.followUps.counts).toBeDefined();
      expect(res.body.stats.callsToday).toBeGreaterThanOrEqual(2);
    });
  });

  describe("search, filtering and bulk actions", () => {
    it("searches by name, phone and company, with pagination metadata", async () => {
      const byName = await owner.get("/api/v1/leads/search?q=Priya").expect(200);
      expect(byName.body.items.length).toBeGreaterThanOrEqual(1);
      expect(byName.body.page).toBe(1);
      expect(byName.body.total).toBeGreaterThanOrEqual(1);

      const byPhone = await owner.get("/api/v1/leads/search?q=9000000002").expect(200);
      expect(byPhone.body.items.some((l: { fullName: string }) => l.fullName === "Priya Nair")).toBe(true);

      const byCompany = await owner.get("/api/v1/leads/search?q=Nair Textiles").expect(200);
      expect(byCompany.body.items.length).toBeGreaterThanOrEqual(1);
    });

    it("filters by owner, priority, tag and score band", async () => {
      const byOwner = await owner.get(`/api/v1/leads/search?ownerId=${repId}`).expect(200);
      expect(byOwner.body.items.every((l: { ownerId: string }) => l.ownerId === repId)).toBe(true);

      const byPriority = await owner.get("/api/v1/leads/search?priority=HIGH").expect(200);
      expect(byPriority.body.items.every((l: { priority: string }) => l.priority === "HIGH")).toBe(true);

      const byTag = await owner.get("/api/v1/leads/search?tag=textiles").expect(200);
      expect(byTag.body.items.length).toBeGreaterThanOrEqual(1);

      const hot = await owner.get("/api/v1/leads/search?minScore=50").expect(200);
      expect(hot.body.items.every((l: { score: number }) => l.score >= 50)).toBe(true);
    });

    it("honours pageSize and caps it", async () => {
      const res = await owner.get("/api/v1/leads/search?pageSize=2").expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      expect(res.body.pageSize).toBe(2);

      const capped = await owner.get("/api/v1/leads/search?pageSize=9999").expect(200);
      expect(capped.body.pageSize).toBe(100);
    });

    it("bulk-assigns leads to a named owner and audits each reassignment", async () => {
      const a = await owner.post("/api/v1/leads").send({ fullName: "Bulk A" }).expect(201);
      const b = await owner.post("/api/v1/leads").send({ fullName: "Bulk B" }).expect(201);

      const res = await owner
        .post("/api/v1/leads/bulk/assign")
        .send({ leadIds: [a.body.id, b.body.id], ownerId: repId })
        .expect(201);

      expect(res.body.assigned).toBe(2);

      const check = await owner.get(`/api/v1/leads/${a.body.id}`).expect(200);
      expect(check.body.ownerId).toBe(repId);

      const audit = await owner.get("/api/v1/audit-events").expect(200);
      expect(audit.body.some((e: { action: string }) => e.action === "lead.reassigned")).toBe(true);
    });

    it("bulk-tags additively without dropping existing tags", async () => {
      const lead = await owner.post("/api/v1/leads").send({ fullName: "Tagged", tags: ["original"] }).expect(201);

      await owner.post("/api/v1/leads/bulk/tag").send({ leadIds: [lead.body.id], tags: ["added"] }).expect(201);

      const res = await owner.get(`/api/v1/leads/${lead.body.id}`).expect(200);
      expect(res.body.tags.sort()).toEqual(["added", "original"]);
    });

    it("blocks an employee from running bulk actions or reassigning a lead", async () => {
      const lead = await owner.post("/api/v1/leads").send({ fullName: "Not Yours", ownerId: repId }).expect(201);

      await rep.post("/api/v1/leads/bulk/assign").send({ leadIds: [lead.body.id], ownerId: repId }).expect(403);
      await rep.patch(`/api/v1/leads/${lead.body.id}/assign`).send({ ownerId: otherRepId }).expect(403);
    });

    it("reassigns a lead as a manager and records it on the timeline", async () => {
      const lead = await owner.post("/api/v1/leads").send({ fullName: "Reassign Me", ownerId: repId }).expect(201);

      const res = await manager.patch(`/api/v1/leads/${lead.body.id}/assign`).send({ ownerId: repId }).expect(200);
      expect(res.body.ownerId).toBe(repId);
    });
  });

  describe("RBAC scoping", () => {
    it("hides another telecaller's lead from an employee", async () => {
      const lead = await owner.post("/api/v1/leads").send({ fullName: "Rep Only", ownerId: repId }).expect(201);
      await otherRep.get(`/api/v1/leads/${lead.body.id}`).expect(403);
      await otherRep.patch(`/api/v1/leads/${lead.body.id}/stage`).send({ stageId: leadStages[1].id }).expect(403);
    });

    it("shows a manager their direct report's leads but not an unrelated employee's", async () => {
      const mine = await owner.post("/api/v1/leads").send({ fullName: "Team Lead Record", ownerId: repId }).expect(201);
      const theirs = await owner
        .post("/api/v1/leads")
        .send({ fullName: "Other Team Record", ownerId: otherRepId })
        .expect(201);

      await manager.get(`/api/v1/leads/${mine.body.id}`).expect(200);
      await manager.get(`/api/v1/leads/${theirs.body.id}`).expect(403);

      const list = await manager.get("/api/v1/leads").expect(200);
      const ids = list.body.map((l: { id: string }) => l.id);
      expect(ids).toContain(mine.body.id);
      expect(ids).not.toContain(theirs.body.id);
    });

    it("blocks an employee from changing the org's lead scoring weights", async () => {
      await rep.patch("/api/v1/leads/score-config").send({ hotThreshold: 10 }).expect(403);
    });

    it("blocks an employee from the manager and admin CRM dashboards", async () => {
      await rep.get("/api/v1/reports/team-performance").expect(403);
      await rep.get("/api/v1/reports/crm-overview").expect(403);
    });

    it("blocks a manager from the admin-only CRM overview but allows team performance", async () => {
      await manager.get("/api/v1/reports/team-performance").expect(200);
      await manager.get("/api/v1/reports/crm-overview").expect(403);
    });
  });

  describe("manager and admin dashboards", () => {
    it("returns team KPIs and a per-employee performance row for every member", async () => {
      const res = await owner.get("/api/v1/reports/team-performance").expect(200);

      expect(res.body.kpis.totalLeads).toBeGreaterThan(0);
      expect(Array.isArray(res.body.leadsByStage)).toBe(true);
      expect(Array.isArray(res.body.leadsBySource)).toBe(true);

      const repRow = res.body.perEmployee.find((r: { employeeId: string }) => r.employeeId === repId);
      expect(repRow).toBeDefined();
      expect(repRow.calls).toBeGreaterThanOrEqual(2);
      expect(repRow.connected).toBeGreaterThanOrEqual(1);
      expect(repRow.connectRate).toBeGreaterThan(0);
      expect(repRow.followUpsCompleted).toBeGreaterThanOrEqual(1);

      // Someone with no activity still appears, so the comparison chart has every bar.
      expect(res.body.perEmployee.some((r: { employeeId: string }) => r.employeeId === otherRepId)).toBe(true);
    });

    it("returns the admin CRM overview with a funnel, sources and follow-up health", async () => {
      const res = await owner.get("/api/v1/reports/crm-overview").expect(200);

      expect(res.body.totals.totalLeads).toBeGreaterThan(0);
      expect(res.body.totals.activeEmployees).toBeGreaterThanOrEqual(4);
      expect(res.body.funnel.length).toBeGreaterThan(0);
      // The funnel excludes loss stages — it is a funnel, not a status list.
      expect(res.body.funnel.some((f: { label: string }) => f.label === "Lost")).toBe(false);
      expect(res.body.followUpPerformance.completed).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.dailyTrend)).toBe(true);
      expect(Array.isArray(res.body.assignmentDistribution)).toBe(true);
    });

    it("accepts an explicit date window", async () => {
      const from = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
      const to = new Date().toISOString();
      const res = await owner.get(`/api/v1/reports/crm-overview?from=${from}&to=${to}`).expect(200);
      expect(res.body.window.from).toBeDefined();
      expect(res.body.dailyTrend.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("conversion into the existing opportunity model", () => {
    it("converts a qualified lead and carries its captured budget across as the deal amount", async () => {
      const lead = await owner
        .post("/api/v1/leads")
        .send({ fullName: "Convert Me", company: "Convert Co", ownerId: repId })
        .expect(201);

      await rep
        .patch(`/api/v1/leads/${lead.body.id}/qualification`)
        .send({ budgetMinor: 750_00, timelineDays: 20, requirement: "Annual plan" })
        .expect(200);

      const res = await rep
        .post(`/api/v1/leads/${lead.body.id}/convert`)
        .send({ title: "Convert Co — annual plan" })
        .expect(201);

      expect(res.body.amountMinor).toBe(750_00);
      expect(res.body.company).toBe("Convert Co");

      const after = await rep.get(`/api/v1/leads/${lead.body.id}`).expect(200);
      expect(after.body.status).toBe("CONVERTED");
      expect(after.body.convertedOpportunityId).toBe(res.body.id);
    });

    it("refuses to put an opportunity on the lead pipeline", async () => {
      const leadPipelines = await owner.get("/api/v1/pipelines?kind=LEAD").expect(200);
      const lead = await owner.post("/api/v1/leads").send({ fullName: "Wrong Pipeline", ownerId: repId }).expect(201);

      await rep
        .post(`/api/v1/leads/${lead.body.id}/convert`)
        .send({ title: "Should fail", pipelineId: leadPipelines.body[0].id })
        .expect(400);
    });

    it("refuses to move a converted lead on the telecalling board", async () => {
      const lead = await owner.post("/api/v1/leads").send({ fullName: "Already Converted", ownerId: repId }).expect(201);
      await rep
        .patch(`/api/v1/leads/${lead.body.id}/qualification`)
        .send({ budgetMinor: 100, timelineDays: 5, requirement: "x" })
        .expect(200);
      await rep.post(`/api/v1/leads/${lead.body.id}/convert`).send({ title: "Converted deal" }).expect(201);

      await rep.patch(`/api/v1/leads/${lead.body.id}/stage`).send({ stageId: leadStages[1].id }).expect(400);
    });
  });

  describe("employee lifecycle still works alongside the CRM changes", () => {
    it("edits an employee, changes their role and deactivates rather than deletes them", async () => {
      const email = `crm-lifecycle-${stamp}@e2e.local`;
      const created = await owner
        .post("/api/v1/employees")
        .send({ fullName: "Lifecycle Person", email, role: "EMPLOYEE" })
        .expect(201);

      await owner.patch(`/api/v1/employees/${created.body.id}`).send({ department: "Inside Sales" }).expect(200);
      await owner.patch(`/api/v1/employees/${created.body.id}`).send({ role: "MANAGER" }).expect(200);

      await owner.delete(`/api/v1/employees/${created.body.id}`).send({ reason: "left the company" }).expect(200);

      const after = await prisma.employee.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(after.employmentStatus).toBe("SEPARATED");
      expect(after.separatedAt).not.toBeNull();
    });

    it("blocks an employee from deleting another employee", async () => {
      await rep.delete(`/api/v1/employees/${otherRepId}`).send({ reason: "nope" }).expect(403);
    });
  });
});
