-- CreateEnum
CREATE TYPE "AssignmentRuleMode" AS ENUM ('ROUND_ROBIN', 'TERRITORY', 'CAPACITY');

-- AlterTable
ALTER TABLE "assignment_rules" ADD COLUMN     "maxOpenLeads" INTEGER,
ADD COLUMN     "mode" "AssignmentRuleMode" NOT NULL DEFAULT 'ROUND_ROBIN',
ADD COLUMN     "territoryMap" JSONB;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "territory" TEXT;
