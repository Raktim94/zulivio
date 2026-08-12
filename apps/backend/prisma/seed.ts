import { PrismaClient, Role } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.organization.findFirst();
  if (existing) {
    console.log("Seed skipped: an organization already exists.");
    return;
  }

  const org = await prisma.organization.create({
    data: { name: "Demo Organization", timezone: "Asia/Kolkata" },
  });

  const password = process.env.SEED_MASTER_OWNER_PASSWORD;
  if (!password) {
    throw new Error(
      "Set SEED_MASTER_OWNER_PASSWORD before seeding — no default password is baked in.",
    );
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const owner = await prisma.employee.create({
    data: {
      organizationId: org.id,
      employeeNumber: "EMP-0001",
      fullName: "Demo Master Owner",
      email: "owner@demo.local",
      passwordHash,
      role: Role.MASTER_OWNER,
      mustChangePassword: false,
    },
  });

  await prisma.auditEvent.create({
    data: {
      organizationId: org.id,
      actorId: owner.id,
      action: "organization.seeded",
      targetType: "organization",
      targetId: org.id,
    },
  });

  console.log(`Seeded organization "${org.name}" with master owner ${owner.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
