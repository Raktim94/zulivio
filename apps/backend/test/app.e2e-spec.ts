import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

describe("NodeDR CRM (e2e)", () => {
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

  it("reports readiness once the database is reachable", async () => {
    await request(server()).get("/api/health/ready").expect(200);
  });

  afterAll(async () => {
    // Best-effort cleanup of everything this run created, so the test DB
    // stays reusable across runs.
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
