import { PrismaClient } from "@prisma/client";
import { normalizePhone } from "../src/common/phone.util";

const prisma = new PrismaClient();

/**
 * One-off cleanup for `Lead.phone` values written before the phone-
 * normalization fix — Excel scientific notation like "9.18605E+11",
 * inconsistent spacing/dashes, etc. Re-runs `normalizePhone` over every
 * existing lead's phone and writes back only the ones that actually change.
 *
 * Defaults to a dry run (prints what would change, touches nothing).
 * Set APPLY=true to actually write the changes.
 */
async function main() {
  const apply = process.env.APPLY === "true";
  const leads = await prisma.lead.findMany({
    where: { phone: { not: null } },
    select: { id: true, fullName: true, phone: true },
  });

  const changes = leads
    .map((lead) => ({ ...lead, normalized: normalizePhone(lead.phone) ?? "" }))
    .filter((lead) => lead.normalized !== lead.phone);

  console.log(`${leads.length} lead(s) with a phone number, ${changes.length} need normalizing.`);
  for (const c of changes) {
    console.log(`  ${c.id} (${c.fullName}): "${c.phone}" -> "${c.normalized}"`);
  }

  if (!apply) {
    console.log("\nDry run only — no changes written. Re-run with APPLY=true to apply them.");
    return;
  }

  for (const c of changes) {
    await prisma.lead.update({ where: { id: c.id }, data: { phone: c.normalized } });
  }
  console.log(`\nUpdated ${changes.length} lead(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
