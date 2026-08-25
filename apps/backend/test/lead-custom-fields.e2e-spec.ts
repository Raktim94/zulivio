import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

/**
 * Covers the CSV-import "any header becomes a searchable field" work:
 * columns with a real Lead column (full_name/email/phone/company/website)
 * map onto it, and everything else (rating/category/city/outreach_angle/...)
 * lands in `customFields` instead of being silently dropped, and is still
 * reachable through the board search.
 */
describe("Lead CSV import — custom fields (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const ownerEmail = `custom-fields-owner-${stamp}@e2e.local`;
  const ownerPassword = "SuperSecret123!";

  const server = () => app.getHttpServer();

  let owner: ReturnType<typeof request.agent>;

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
        organizationName: `Custom Fields Org ${stamp}`,
        fullName: "Custom Fields Owner",
        email: ownerEmail,
        password: ownerPassword,
      })
      .expect(201);

    owner = request.agent(server());
    await owner.post("/api/v1/auth/sessions").send({ email: ownerEmail, password: ownerPassword }).expect(201);
  });

  afterAll(async () => {
    await prisma.leadActivity.deleteMany({});
    await prisma.leadFollowUp.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.pipelineStage.deleteMany({});
    await prisma.pipeline.deleteMany({});
    await prisma.auditEvent.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.employee.deleteMany({});
    await prisma.organization.deleteMany({});
    await app.close();
  });

  const csv = [
    "contact_rank,phone_local_10d,full_name,email,company,category,city,state,rating,website,confidence,outreach_angle",
    '1,9876543210,Asha Rao,asha@example.com,Rao Textiles,Manufacturing,Bengaluru,Karnataka,4.5,raotextiles.example.com,High,"Mention their new export line"',
  ].join("\n");

  it("maps recognized headers to real fields and buckets the rest into customFields", async () => {
    const res = await owner
      .post("/api/v1/imports/leads/csv")
      .attach("file", Buffer.from(csv), "leads.csv")
      .expect(201);

    expect(res.body.createdCount).toBe(1);
    expect(res.body.errorCount).toBe(0);

    const created = res.body.created[0];
    expect(created.fullName).toBe("Asha Rao");
    expect(created.email).toBe("asha@example.com");
    expect(created.phone).toBe("9876543210");
    expect(created.company).toBe("Rao Textiles");
    expect(created.website).toBe("raotextiles.example.com");

    // Columns with no dedicated Lead field must survive, not be dropped.
    expect(created.customFields).toEqual({
      contact_rank: "1",
      category: "Manufacturing",
      city: "Bengaluru",
      state: "Karnataka",
      rating: "4.5",
      confidence: "High",
      outreach_angle: "Mention their new export line",
    });
  });

  it("finds the lead by searching a value that only lives in customFields", async () => {
    const res = await owner.get("/api/v1/leads/search?q=export+line").expect(200);
    expect(res.body.items.some((l: { fullName: string }) => l.fullName === "Asha Rao")).toBe(true);
  });

  it("does not match an unrelated search term", async () => {
    const res = await owner.get("/api/v1/leads/search?q=zzz-no-such-lead").expect(200);
    expect(res.body.items).toHaveLength(0);
  });
});
