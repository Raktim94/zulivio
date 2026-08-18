import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

// MCP Streamable HTTP requires both of these per the spec — see
// webStandardStreamableHttp.js's Accept/Content-Type validation.
const MCP_HEADERS = { Accept: "application/json, text/event-stream", "Content-Type": "application/json" };

describe("API keys + MCP server (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const orgEmail = `mcp-owner-${Date.now()}@e2e.local`;
  const orgPassword = "SuperSecret123!";

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await request(server())
      .post("/api/v1/bootstrap")
      .send({ organizationName: "MCP E2E Org", fullName: "Owner Person", email: orgEmail, password: orgPassword })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({});
    await prisma.auditEvent.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.employee.deleteMany({});
    await prisma.organization.deleteMany({});
    await app.close();
  });

  const server = () => app.getHttpServer();

  it("creates an API key, never returning the token again on list", async () => {
    const agent = request.agent(server());
    await agent.post("/api/v1/auth/sessions").send({ email: orgEmail, password: orgPassword }).expect(201);

    const created = await agent.post("/api/v1/api-keys").send({ name: "Test Key" }).expect(201);
    expect(created.body.token).toMatch(/^zlv_/);
    expect(created.body.lastFour).toHaveLength(4);

    const listed = await agent.get("/api/v1/api-keys").expect(200);
    const entry = listed.body.find((k: { id: string }) => k.id === created.body.id);
    expect(entry).toBeDefined();
    expect(entry.token).toBeUndefined();
    expect(entry.lastFour).toBe(created.body.lastFour);
  });

  it("authenticates REST requests via Authorization: Bearer, resolving to the key's owner", async () => {
    const agent = request.agent(server());
    await agent.post("/api/v1/auth/sessions").send({ email: orgEmail, password: orgPassword }).expect(201);
    const created = await agent.post("/api/v1/api-keys").send({ name: "Bearer Test" }).expect(201);

    const res = await request(server())
      .get("/api/v1/employees/me")
      .set("Authorization", `Bearer ${created.body.token}`)
      .expect(200);
    expect(res.body.email).toBe(orgEmail);
  });

  it("rejects an invalid bearer token", async () => {
    await request(server())
      .get("/api/v1/employees/me")
      .set("Authorization", "Bearer zlv_not-a-real-token")
      .expect(401);
  });

  it("revoking a key immediately invalidates it", async () => {
    const agent = request.agent(server());
    await agent.post("/api/v1/auth/sessions").send({ email: orgEmail, password: orgPassword }).expect(201);
    const created = await agent.post("/api/v1/api-keys").send({ name: "Revoke Test" }).expect(201);

    await request(server())
      .get("/api/v1/employees/me")
      .set("Authorization", `Bearer ${created.body.token}`)
      .expect(200);

    await agent.delete(`/api/v1/api-keys/${created.body.id}`).expect(200);

    await request(server())
      .get("/api/v1/employees/me")
      .set("Authorization", `Bearer ${created.body.token}`)
      .expect(401);
  });

  it("only lets an employee revoke their own key", async () => {
    const ownerAgent = request.agent(server());
    await ownerAgent.post("/api/v1/auth/sessions").send({ email: orgEmail, password: orgPassword }).expect(201);
    const ownerKey = await ownerAgent.post("/api/v1/api-keys").send({ name: "Owner's key" }).expect(201);

    const managerEmail = `mcp-manager-${Date.now()}@e2e.local`;
    const created = await ownerAgent
      .post("/api/v1/employees")
      .send({ fullName: "Manager Person", email: managerEmail, role: "MANAGER" })
      .expect(201);

    const managerAgent = request.agent(server());
    await managerAgent
      .post("/api/v1/auth/sessions")
      .send({ email: managerEmail, password: created.body.temporaryPassword })
      .expect(201);

    await managerAgent.delete(`/api/v1/api-keys/${ownerKey.body.id}`).expect(403);
  });

  it("rejects unauthenticated MCP requests", async () => {
    await request(server())
      .post("/api/v1/mcp")
      .set(MCP_HEADERS)
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } })
      .expect(401);
  });

  it("initializes an MCP session and lists tools with a valid API key", async () => {
    const agent = request.agent(server());
    await agent.post("/api/v1/auth/sessions").send({ email: orgEmail, password: orgPassword }).expect(201);
    const created = await agent.post("/api/v1/api-keys").send({ name: "MCP Key" }).expect(201);
    const auth = { Authorization: `Bearer ${created.body.token}` };

    const init = await request(server())
      .post("/api/v1/mcp")
      .set({ ...MCP_HEADERS, ...auth })
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-client", version: "1.0" } },
      })
      .expect(200);
    expect(init.text).toContain("zulivio");

    const list = await request(server())
      .post("/api/v1/mcp")
      .set({ ...MCP_HEADERS, ...auth })
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
      .expect(200);
    expect(list.text).toContain("list_employees");
    expect(list.text).toContain("create_lead");
    expect(list.text).toContain("sales_dashboard");
  });

  it("calls a read tool through MCP and gets real data back", async () => {
    const agent = request.agent(server());
    await agent.post("/api/v1/auth/sessions").send({ email: orgEmail, password: orgPassword }).expect(201);
    const created = await agent.post("/api/v1/api-keys").send({ name: "MCP Tool Call Key" }).expect(201);

    const res = await request(server())
      .post("/api/v1/mcp")
      .set({ ...MCP_HEADERS, Authorization: `Bearer ${created.body.token}` })
      .send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_employees", arguments: {} } })
      .expect(200);
    expect(res.text).toContain(orgEmail);
  });
});
