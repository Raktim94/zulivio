import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

describe("Zulivio (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const orgEmail = `owner-${Date.now()}@e2e.local`;
  const orgPassword = "SuperSecret123!";

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  describe("bootstrap and authentication", () => {
    it("rejects requests to protected routes without a session", async () => {
      await request(server()).get("/api/v1/employees").expect(401);
    });

    it("bootstraps a new organization with a master owner", async () => {
      const res = await request(server())
        .post("/api/v1/bootstrap")
        .send({
          organizationName: "E2E Test Org",
          fullName: "Owner Person",
          email: orgEmail,
          password: orgPassword,
        })
        .expect(201);

      expect(res.body.employeeNumber).toBe("EMP-0001");
    });

    it("rejects a second bootstrap with the same email", async () => {
      await request(server())
        .post("/api/v1/bootstrap")
        .send({
          organizationName: "Another Org",
          fullName: "Owner Person",
          email: orgEmail,
          password: orgPassword,
        })
        .expect(400);
    });

    it("rejects login with the wrong password", async () => {
      await request(server())
        .post("/api/v1/auth/sessions")
        .send({ email: orgEmail, password: "wrong-password" })
        .expect(401);
    });

    it("logs in with correct credentials and sets a session cookie", async () => {
      const res = await request(server())
        .post("/api/v1/auth/sessions")
        .send({ email: orgEmail, password: orgPassword })
        .expect(201);

      expect(res.headers["set-cookie"]).toBeDefined();
      expect(res.body.employee.role).toBe("MASTER_OWNER");
    });
  });

  describe("RBAC hierarchy", () => {
    let managerCreds: { email: string; password: string };
    let employeeCreds: { email: string; password: string; id: string };
    let ownerId: string;

    beforeAll(async () => {
      const res = await request
        .agent(server())
        .post("/api/v1/auth/sessions")
        .send({ email: orgEmail, password: orgPassword });
      ownerId = res.body.employee.id;
    });

    it("lets the master owner create a manager", async () => {
      const agent = request.agent(server());
      await agent.post("/api/v1/auth/sessions").send({ email: orgEmail, password: orgPassword }).expect(201);

      const email = `manager-${Date.now()}@e2e.local`;
      const res = await agent
        .post("/api/v1/employees")
        .send({ fullName: "Manager Person", email, role: "MANAGER" })
        .expect(201);

      managerCreds = { email, password: res.body.temporaryPassword };
      expect(res.body.temporaryPassword).toHaveLength(14);
    });

    it("blocks a manager from creating a peer-or-higher role (privilege escalation)", async () => {
      const agent = request.agent(server());
      await agent.post("/api/v1/auth/sessions").send(managerCreds).expect(201);

      await agent
        .post("/api/v1/employees")
        .send({ fullName: "Should Fail", email: `x-${Date.now()}@e2e.local`, role: "SALES_HEAD" })
        .expect(403);
    });

    it("lets a manager create an employee below their rank", async () => {
      const agent = request.agent(server());
      await agent.post("/api/v1/auth/sessions").send(managerCreds).expect(201);

      const email = `employee-${Date.now()}@e2e.local`;
      const res = await agent
        .post("/api/v1/employees")
        .send({ fullName: "Line Employee", email, role: "EMPLOYEE" })
        .expect(201);

      employeeCreds = { email, password: res.body.temporaryPassword, id: res.body.id };
    });

    it("blocks a plain employee from creating other employees", async () => {
      const agent = request.agent(server());
      await agent
        .post("/api/v1/auth/sessions")
        .send({ email: employeeCreds.email, password: employeeCreds.password })
        .expect(201);

      await agent
        .post("/api/v1/employees")
        .send({ fullName: "Nope", email: `nope-${Date.now()}@e2e.local`, role: "EMPLOYEE" })
        .expect(403);
    });

    it("blocks an employee from viewing another employee's attendance report", async () => {
      const employeeAgent = request.agent(server());
      await employeeAgent
        .post("/api/v1/auth/sessions")
        .send({ email: employeeCreds.email, password: employeeCreds.password })
        .expect(201);

      await employeeAgent.get(`/api/v1/work-sessions/report/${ownerId}`).expect(403);
    });

    it("lets the owner edit a subordinate's role and department", async () => {
      const agent = request.agent(server());
      await agent.post("/api/v1/auth/sessions").send({ email: orgEmail, password: orgPassword }).expect(201);

      const res = await agent
        .patch(`/api/v1/employees/${employeeCreds.id}`)
        .send({ role: "MANAGER", department: "Operations" })
        .expect(200);

      expect(res.body.role).toBe("MANAGER");
      expect(res.body.department).toBe("Operations");
    });

    it("blocks promoting a subordinate to a peer-or-higher role via update", async () => {
      const agent = request.agent(server());
      await agent.post("/api/v1/auth/sessions").send({ email: orgEmail, password: orgPassword }).expect(201);

      await agent
        .patch(`/api/v1/employees/${employeeCreds.id}`)
        .send({ role: "MASTER_OWNER" })
        .expect(403);
    });

    it("blocks a manager from editing a peer-or-higher-ranked employee", async () => {
      const agent = request.agent(server());
      await agent.post("/api/v1/auth/sessions").send(managerCreds).expect(201);

      await agent.patch(`/api/v1/employees/${ownerId}`).send({ department: "Nope" }).expect(403);
    });

    it("lets the owner force-reset a subordinate's password, revoking their sessions", async () => {
      const employeeAgent = request.agent(server());
      await employeeAgent
        .post("/api/v1/auth/sessions")
        .send({ email: employeeCreds.email, password: employeeCreds.password })
        .expect(201);
      // Confirm the pre-reset session actually works before we invalidate it.
      await employeeAgent.get("/api/v1/employees/me").expect(200);

      const ownerAgent = request.agent(server());
      await ownerAgent.post("/api/v1/auth/sessions").send({ email: orgEmail, password: orgPassword }).expect(201);
      const res = await ownerAgent
        .post(`/api/v1/employees/${employeeCreds.id}/reset-password`)
        .expect(201);

      expect(res.body.temporaryPassword).toHaveLength(14);

      // The old session must be dead — reset revokes all active sessions.
      await employeeAgent.get("/api/v1/employees/me").expect(401);

      // The new temporary password must work.
      const reloginAgent = request.agent(server());
      await reloginAgent
        .post("/api/v1/auth/sessions")
        .send({ email: employeeCreds.email, password: res.body.temporaryPassword })
        .expect(201);
    });

    it("scopes the employee directory to self + strictly-lower ranks, never a peer or above", async () => {
      // Fully self-contained fixtures — earlier tests in this describe
      // block mutate the shared managerCreds/employeeCreds roles (one test
      // promotes employeeCreds to MANAGER), so this builds its own clean
      // org-chart slice rather than relying on that shared, mutated state.
      const ownerAgent = request.agent(server());
      await ownerAgent.post("/api/v1/auth/sessions").send({ email: orgEmail, password: orgPassword }).expect(201);

      const salesHeadEmail = `saleshead-${Date.now()}@e2e.local`;
      const salesHeadRes = await ownerAgent
        .post("/api/v1/employees")
        .send({ fullName: "Sales Head Person", email: salesHeadEmail, role: "SALES_HEAD" })
        .expect(201);
      const salesHeadAgent = request.agent(server());
      await salesHeadAgent
        .post("/api/v1/auth/sessions")
        .send({ email: salesHeadEmail, password: salesHeadRes.body.temporaryPassword })
        .expect(201);

      const freshManagerEmail = `mgr2-${Date.now()}@e2e.local`;
      const freshManagerRes = await salesHeadAgent
        .post("/api/v1/employees")
        .send({ fullName: "Fresh Manager", email: freshManagerEmail, role: "MANAGER" })
        .expect(201);
      const freshManagerAgent = request.agent(server());
      await freshManagerAgent
        .post("/api/v1/auth/sessions")
        .send({ email: freshManagerEmail, password: freshManagerRes.body.temporaryPassword })
        .expect(201);

      const freshEmployeeEmail = `emp2-${Date.now()}@e2e.local`;
      const freshEmployeeRes = await freshManagerAgent
        .post("/api/v1/employees")
        .send({ fullName: "Fresh Employee", email: freshEmployeeEmail, role: "EMPLOYEE" })
        .expect(201);

      // Sales head sees the manager and employee below them, never the owner above.
      const salesHeadList = await salesHeadAgent.get("/api/v1/employees").expect(200);
      const salesHeadIds = salesHeadList.body.map((e: { id: string }) => e.id);
      expect(salesHeadIds).toContain(salesHeadRes.body.id); // self
      expect(salesHeadIds).toContain(freshManagerRes.body.id); // strictly lower
      expect(salesHeadIds).toContain(freshEmployeeRes.body.id); // strictly lower
      expect(salesHeadIds).not.toContain(ownerId); // strictly higher — excluded

      // The manager sees the employee below them, never the sales head or owner above.
      const freshManagerList = await freshManagerAgent.get("/api/v1/employees").expect(200);
      const freshManagerIds = freshManagerList.body.map((e: { id: string }) => e.id);
      expect(freshManagerIds).toContain(freshEmployeeRes.body.id); // strictly lower
      expect(freshManagerIds).not.toContain(salesHeadRes.body.id); // strictly higher — excluded
      expect(freshManagerIds).not.toContain(ownerId); // strictly higher — excluded

      // A plain employee (lowest rank) sees only themselves.
      const freshEmployeeAgent = request.agent(server());
      await freshEmployeeAgent
        .post("/api/v1/auth/sessions")
        .send({ email: freshEmployeeEmail, password: freshEmployeeRes.body.temporaryPassword })
        .expect(201);
      const freshEmployeeList = await freshEmployeeAgent.get("/api/v1/employees").expect(200);
      expect(freshEmployeeList.body.map((e: { id: string }) => e.id)).toEqual([freshEmployeeRes.body.id]);
    });
  });

  describe("audit log", () => {
    it("is Master-Owner only, and records employee-management actions", async () => {
      const ownerAgent = request.agent(server());
      const ownerLogin = await ownerAgent
        .post("/api/v1/auth/sessions")
        .send({ email: orgEmail, password: orgPassword })
        .expect(201);
      const auditOwnerId = ownerLogin.body.employee.id;

      const email = `audit-subject-${Date.now()}@e2e.local`;
      const created = await ownerAgent
        .post("/api/v1/employees")
        .send({ fullName: "Audit Subject", email, role: "EMPLOYEE" })
        .expect(201);

      const subjectAgent = request.agent(server());
      await subjectAgent
        .post("/api/v1/auth/sessions")
        .send({ email, password: created.body.temporaryPassword })
        .expect(201);
      // Below Master Owner rank — must not be able to read the audit log.
      await subjectAgent.get("/api/v1/audit-events").expect(403);

      const res = await ownerAgent.get("/api/v1/audit-events").expect(200);
      const createdEvent = res.body.find(
        (e: { targetId: string; action: string }) => e.targetId === created.body.id && e.action === "employee.created",
      );
      expect(createdEvent).toBeDefined();
      expect(createdEvent.actor.id).toBe(auditOwnerId);
    });
  });

  describe("cross-tenant isolation", () => {
    // SECURITY.md states tenant isolation is 100% application-layer (no
    // Postgres RLS) — every service scopes its queries by
    // actor.organizationId, but nothing had ever proven that under ID
    // tampering across two real organizations. This builds two fully
    // separate orgs and confirms Org B can never reach Org A's records by
    // guessing/reusing an ID, even when Org B's actor outranks the target
    // within their own org (role rank alone must never substitute for
    // org membership).
    let orgAOwnerAgent: ReturnType<typeof request.agent>;
    let orgBOwnerAgent: ReturnType<typeof request.agent>;
    let orgAEmployeeId: string;
    let orgAAssignmentId: string;
    let orgALeadId: string;
    let orgAOpportunityId: string;
    let orgAAuditEventId: string;

    beforeAll(async () => {
      orgAOwnerAgent = request.agent(server());
      const orgAEmail = `tenant-a-owner-${Date.now()}@e2e.local`;
      await orgAOwnerAgent.post("/api/v1/bootstrap").send({
        organizationName: "Tenant A",
        fullName: "Tenant A Owner",
        email: orgAEmail,
        password: orgPassword,
      });
      await orgAOwnerAgent.post("/api/v1/auth/sessions").send({ email: orgAEmail, password: orgPassword });

      const empRes = await orgAOwnerAgent
        .post("/api/v1/employees")
        .send({ fullName: "Tenant A Employee", email: `tenant-a-emp-${Date.now()}@e2e.local`, role: "EMPLOYEE" });
      orgAEmployeeId = empRes.body.id;
      orgAAuditEventId = empRes.body.id; // employee.created event's targetId

      const assignmentRes = await orgAOwnerAgent
        .post("/api/v1/assignments")
        .send({ title: "Tenant A only", ownerId: orgAEmployeeId });
      orgAAssignmentId = assignmentRes.body.id;

      const leadRes = await orgAOwnerAgent
        .post("/api/v1/leads")
        .send({ fullName: "Tenant A Lead", email: "tenant-a-lead@example.com" });
      orgALeadId = leadRes.body.id;

      const oppRes = await orgAOwnerAgent
        .post("/api/v1/opportunities")
        .send({ title: "Tenant A Opportunity" });
      orgAOpportunityId = oppRes.body.id;

      orgBOwnerAgent = request.agent(server());
      const orgBEmail = `tenant-b-owner-${Date.now()}@e2e.local`;
      await orgBOwnerAgent.post("/api/v1/bootstrap").send({
        organizationName: "Tenant B",
        fullName: "Tenant B Owner",
        email: orgBEmail,
        password: orgPassword,
      });
      await orgBOwnerAgent.post("/api/v1/auth/sessions").send({ email: orgBEmail, password: orgPassword });
    });

    it("404s a cross-org employee edit, reset-password, and remove — despite Org B's actor outranking the target", async () => {
      await orgBOwnerAgent.patch(`/api/v1/employees/${orgAEmployeeId}`).send({ department: "Nope" }).expect(404);
      await orgBOwnerAgent.post(`/api/v1/employees/${orgAEmployeeId}/reset-password`).expect(404);
      await orgBOwnerAgent
        .delete(`/api/v1/employees/${orgAEmployeeId}`)
        .send({ reason: "cross-tenant probe" })
        .expect(404);
    });

    it("excludes Org A employees from Org B's directory listing", async () => {
      const res = await orgBOwnerAgent.get("/api/v1/employees").expect(200);
      expect(res.body.map((e: { id: string }) => e.id)).not.toContain(orgAEmployeeId);
    });

    it("404s cross-org assignment assign and transition", async () => {
      const orgBEmployeeRes = await orgBOwnerAgent
        .post("/api/v1/employees")
        .send({ fullName: "Tenant B Employee", email: `tenant-b-emp-${Date.now()}@e2e.local`, role: "EMPLOYEE" });

      await orgBOwnerAgent
        .post(`/api/v1/assignments/${orgAAssignmentId}/assign`)
        .send({ employeeId: orgBEmployeeRes.body.id })
        .expect(404);
      await orgBOwnerAgent
        .post(`/api/v1/assignments/${orgAAssignmentId}/transitions`)
        .send({ toStatus: "IN_PROGRESS" })
        .expect(404);
    });

    it("404s a cross-org lead read", async () => {
      await orgBOwnerAgent.get(`/api/v1/leads/${orgALeadId}`).expect(404);
    });

    it("404s cross-org opportunity stage-transition and forecast-category", async () => {
      await orgBOwnerAgent
        .post(`/api/v1/opportunities/${orgAOpportunityId}/stage-transitions`)
        .send({ stageId: "does-not-matter-in-org-b" })
        .expect(404);
      await orgBOwnerAgent
        .post(`/api/v1/opportunities/${orgAOpportunityId}/forecast-category`)
        .send({ category: "COMMITTED", reason: "cross-tenant probe" })
        .expect(404);
    });

    it("404s a cross-org attendance report request", async () => {
      await orgBOwnerAgent.get(`/api/v1/work-sessions/report/${orgAEmployeeId}`).expect(404);
    });

    it("excludes Org A's audit events from Org B's audit log", async () => {
      const res = await orgBOwnerAgent.get("/api/v1/audit-events").expect(200);
      expect(res.body.map((e: { targetId: string }) => e.targetId)).not.toContain(orgAAuditEventId);
    });
  });

  describe("attendance state machine", () => {
    let agent: ReturnType<typeof request.agent>;
    let sessionId: string;
    let breakId: string;

    beforeAll(async () => {
      agent = request.agent(server());
      const email = `att-${Date.now()}@e2e.local`;
      const ownerAgent = request.agent(server());
      await ownerAgent.post("/api/v1/auth/sessions").send({ email: orgEmail, password: orgPassword });
      const created = await ownerAgent
        .post("/api/v1/employees")
        .send({ fullName: "Attendance Tester", email, role: "EMPLOYEE" });

      await agent.post("/api/v1/auth/sessions").send({ email, password: created.body.temporaryPassword });
    });

    it("starts logged_out", async () => {
      const res = await agent.get("/api/v1/work-sessions/me").expect(200);
      expect(res.body.state).toBe("logged_out");
    });

    it("transitions to working on start", async () => {
      const res = await agent.post("/api/v1/work-sessions/start").expect(201);
      sessionId = res.body.id;

      const status = await agent.get("/api/v1/work-sessions/me").expect(200);
      expect(status.body.state).toBe("working");
    });

    it("rejects starting a second concurrent session", async () => {
      await agent.post("/api/v1/work-sessions/start").expect(400);
    });

    it("transitions to on_break", async () => {
      const res = await agent.post(`/api/v1/work-sessions/${sessionId}/breaks/start`).expect(201);
      breakId = res.body.id;

      const status = await agent.get("/api/v1/work-sessions/me").expect(200);
      expect(status.body.state).toBe("on_break");
    });

    it("rejects starting a second concurrent break", async () => {
      await agent.post(`/api/v1/work-sessions/${sessionId}/breaks/start`).expect(400);
    });

    it("returns to working after ending the break", async () => {
      await agent.post(`/api/v1/work-sessions/${sessionId}/breaks/${breakId}/end`).expect(201);

      const status = await agent.get("/api/v1/work-sessions/me").expect(200);
      expect(status.body.state).toBe("working");
    });

    it("ends the session and returns to logged_out", async () => {
      await agent.post(`/api/v1/work-sessions/${sessionId}/end`).expect(201);

      const status = await agent.get("/api/v1/work-sessions/me").expect(200);
      expect(status.body.state).toBe("logged_out");
    });
  });

  describe("assignment lifecycle", () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let employeeAgent: ReturnType<typeof request.agent>;
    let employeeId: string;
    let assignmentId: string;

    beforeAll(async () => {
      ownerAgent = request.agent(server());
      await ownerAgent.post("/api/v1/auth/sessions").send({ email: orgEmail, password: orgPassword });

      const email = `assignee-${Date.now()}@e2e.local`;
      const created = await ownerAgent
        .post("/api/v1/employees")
        .send({ fullName: "Assignee Person", email, role: "EMPLOYEE" });
      employeeId = created.body.id;

      employeeAgent = request.agent(server());
      await employeeAgent.post("/api/v1/auth/sessions").send({ email, password: created.body.temporaryPassword });
    });

    it("creates and assigns work by employee id", async () => {
      const res = await ownerAgent
        .post("/api/v1/assignments")
        .send({ title: "Follow up with lead #42", ownerId: employeeId })
        .expect(201);

      assignmentId = res.body.id;
      expect(res.body.status).toBe("ASSIGNED");
      expect(res.body.assignmentNumber).toBeGreaterThan(0);
    });

    it("rejects an invalid status transition", async () => {
      await employeeAgent
        .post(`/api/v1/assignments/${assignmentId}/transitions`)
        .send({ toStatus: "COMPLETED" })
        .expect(400);
    });

    it("lets the assignee move through valid transitions", async () => {
      await employeeAgent
        .post(`/api/v1/assignments/${assignmentId}/transitions`)
        .send({ toStatus: "IN_PROGRESS" })
        .expect(201);

      await employeeAgent
        .post(`/api/v1/assignments/${assignmentId}/transitions`)
        .send({ toStatus: "COMPLETED", outcome: "successful" })
        .expect(201);
    });

    it("rejects any transition once completed (terminal state)", async () => {
      await employeeAgent
        .post(`/api/v1/assignments/${assignmentId}/transitions`)
        .send({ toStatus: "IN_PROGRESS" })
        .expect(400);
    });
  });

  describe("sales CRM", () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let repAgent: ReturnType<typeof request.agent>;
    let repId: string;
    let leadId: string;
    let opportunityId: string;
    let stages: { id: string; name: string; isWon: boolean; isLost: boolean }[];

    beforeAll(async () => {
      ownerAgent = request.agent(server());
      await ownerAgent.post("/api/v1/auth/sessions").send({ email: orgEmail, password: orgPassword });

      const email = `rep-${Date.now()}@e2e.local`;
      const created = await ownerAgent
        .post("/api/v1/employees")
        .send({ fullName: "Sales Rep", email, role: "EMPLOYEE" });
      repId = created.body.id;

      repAgent = request.agent(server());
      await repAgent.post("/api/v1/auth/sessions").send({ email, password: created.body.temporaryPassword });

      const pipelines = await ownerAgent.get("/api/v1/pipelines");
      stages = pipelines.body[0].stages;
    });

    it("creates an assignment rule and auto-assigns a lead round-robin", async () => {
      await ownerAgent
        .post("/api/v1/assignment-rules")
        .send({ name: "Default rotation", memberIds: [repId], slaMinutes: 30 })
        .expect(201);

      const res = await ownerAgent
        .post("/api/v1/leads")
        .send({ fullName: "Aditi Sharma", email: "aditi@example.com", autoAssign: true })
        .expect(201);

      leadId = res.body.id;
      expect(res.body.ownerId).toBe(repId);
      expect(res.body.respondBySlaAt).not.toBeNull();
    });

    it("blocks an employee from viewing a lead they don't own or didn't create", async () => {
      const otherEmail = `other-${Date.now()}@e2e.local`;
      const otherCreated = await ownerAgent
        .post("/api/v1/employees")
        .send({ fullName: "Other Employee", email: otherEmail, role: "EMPLOYEE" });
      const otherAgent = request.agent(server());
      await otherAgent
        .post("/api/v1/auth/sessions")
        .send({ email: otherEmail, password: otherCreated.body.temporaryPassword });

      await otherAgent.get(`/api/v1/leads/${leadId}`).expect(403);
    });

    it("lets the assigned rep move the lead through valid status transitions", async () => {
      await repAgent.patch(`/api/v1/leads/${leadId}`).send({ status: "CONTACTED" }).expect(200);
      const res = await repAgent.patch(`/api/v1/leads/${leadId}`).send({ status: "QUALIFIED" }).expect(200);
      expect(res.body.status).toBe("QUALIFIED");
    });

    it("rejects an invalid lead status transition", async () => {
      // QUALIFIED can only go to DISQUALIFIED, not back to NEW.
      await repAgent.patch(`/api/v1/leads/${leadId}`).send({ status: "NEW" }).expect(400);
    });

    it("converts a qualified lead into an opportunity without losing lead history", async () => {
      const res = await repAgent
        .post(`/api/v1/leads/${leadId}/convert`)
        .send({ title: "Aditi Sharma — annual plan", amountMinor: 500000 })
        .expect(201);

      opportunityId = res.body.id;
      expect(res.body.stageId).toBe(stages[0].id);

      const lead = await repAgent.get(`/api/v1/leads/${leadId}`).expect(200);
      expect(lead.body.status).toBe("CONVERTED");
      expect(lead.body.convertedOpportunityId).toBe(opportunityId);
    });

    it("rejects converting the same lead twice", async () => {
      await repAgent
        .post(`/api/v1/leads/${leadId}/convert`)
        .send({ title: "Duplicate conversion attempt" })
        .expect(400);
    });

    it("moves the opportunity through pipeline stages, recording an event each time", async () => {
      const qualifiedStage = stages.find((s) => s.name === "Qualified")!;
      await repAgent
        .post(`/api/v1/opportunities/${opportunityId}/stage-transitions`)
        .send({ stageId: qualifiedStage.id })
        .expect(201);

      const list = await ownerAgent.get("/api/v1/opportunities").expect(200);
      const found = list.body.find((o: { id: string }) => o.id === opportunityId);
      expect(found.stage.name).toBe("Qualified");
    });

    it("requires a lossReason when moving an opportunity to a lost stage", async () => {
      const lostStage = stages.find((s) => s.isLost)!;
      await repAgent
        .post(`/api/v1/opportunities/${opportunityId}/stage-transitions`)
        .send({ stageId: lostStage.id })
        .expect(400);

      await repAgent
        .post(`/api/v1/opportunities/${opportunityId}/stage-transitions`)
        .send({ stageId: lostStage.id, lossReason: "Budget frozen this quarter" })
        .expect(201);
    });

    it("rejects moving a closed (lost) opportunity further", async () => {
      const wonStage = stages.find((s) => s.isWon)!;
      await repAgent
        .post(`/api/v1/opportunities/${opportunityId}/stage-transitions`)
        .send({ stageId: wonStage.id })
        .expect(400);
    });

    it("blocks a plain employee from adjusting the forecast category", async () => {
      await repAgent
        .post(`/api/v1/opportunities/${opportunityId}/forecast-category`)
        .send({ category: "COMMITTED" })
        .expect(403);
    });

    it("lets a manager adjust the forecast category with an audited reason", async () => {
      await ownerAgent
        .post(`/api/v1/opportunities/${opportunityId}/forecast-category`)
        .send({ category: "OMITTED", reason: "Deal is dead" })
        .expect(201);
    });

    it("exports leads as CSV", async () => {
      const res = await ownerAgent.get("/api/v1/exports/leads.csv").expect(200);
      expect(res.text).toContain("Aditi Sharma");
    });

    it("returns sales dashboard data with stage breakdown and win/loss counts", async () => {
      const res = await ownerAgent.get("/api/v1/reports/sales-dashboard").expect(200);
      expect(res.body.winLoss.lost).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.stageBreakdown)).toBe(true);
    });
  });

  it("reports readiness once the database is reachable", async () => {
    await request(server()).get("/api/health/ready").expect(200);
  });

  afterAll(async () => {
    // Best-effort cleanup of everything this run created, so the test DB
    // stays reusable across runs.
    await prisma.forecastAdjustment.deleteMany({});
    await prisma.opportunityEvent.deleteMany({});
    await prisma.opportunity.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.pipelineStage.deleteMany({});
    await prisma.pipeline.deleteMany({});
    await prisma.assignmentRule.deleteMany({});
    await prisma.auditEvent.deleteMany({});
    await prisma.assignmentEvent.deleteMany({});
    await prisma.assignment.deleteMany({});
    await prisma.break.deleteMany({});
    await prisma.workSession.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.employee.deleteMany({});
    await prisma.organization.deleteMany({});
  });
});
