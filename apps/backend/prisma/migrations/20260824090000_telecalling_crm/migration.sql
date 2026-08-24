-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
-- CreateEnum
CREATE TYPE "LeadLossReason" AS ENUM ('NOT_INTERESTED', 'NO_BUDGET', 'WRONG_NUMBER', 'DUPLICATE', 'COMPETITOR', 'NOT_NOW', 'LOST');
-- CreateEnum
CREATE TYPE "PurchaseIntent" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');
-- CreateEnum
CREATE TYPE "PipelineKind" AS ENUM ('OPPORTUNITY', 'LEAD');
-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('CONNECTED', 'NOT_CONNECTED');
-- CreateEnum
CREATE TYPE "CallDisposition" AS ENUM ('INTERESTED', 'QUALIFIED', 'MEETING_BOOKED', 'CALLBACK', 'PROPOSAL_REQUESTED', 'NOT_INTERESTED', 'NO_BUDGET', 'COMPETITOR', 'WRONG_PERSON', 'NO_ANSWER', 'BUSY', 'SWITCHED_OFF', 'INVALID_NUMBER', 'OUT_OF_COVERAGE');
-- CreateEnum
CREATE TYPE "LeadActivityType" AS ENUM ('CALL', 'NOTE', 'MESSAGE', 'MEETING', 'STAGE_CHANGE', 'STATUS_CHANGE', 'QUALIFICATION_UPDATED', 'ASSIGNMENT_CHANGED', 'FOLLOW_UP_SCHEDULED', 'FOLLOW_UP_COMPLETED', 'FOLLOW_UP_RESCHEDULED');
-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELED');
-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "budgetMinor" INTEGER,
ADD COLUMN     "businessType" TEXT,
ADD COLUMN     "callCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "campaign" TEXT,
ADD COLUMN     "existingSolution" TEXT,
ADD COLUMN     "goodBusinessFit" BOOLEAN,
ADD COLUMN     "isDecisionMaker" BOOLEAN,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "lastContactedAt" TIMESTAMP(3),
ADD COLUMN     "lossNotes" TEXT,
ADD COLUMN     "lossReason" "LeadLossReason",
ADD COLUMN     "nextFollowUpAt" TIMESTAMP(3),
ADD COLUMN     "pipelineId" TEXT,
ADD COLUMN     "priority" "LeadPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "purchaseIntent" "PurchaseIntent",
ADD COLUMN     "qualifiedAt" TIMESTAMP(3),
ADD COLUMN     "requirement" TEXT,
ADD COLUMN     "requirementUrgent" BOOLEAN,
ADD COLUMN     "score" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stageChangedAt" TIMESTAMP(3),
ADD COLUMN     "stageId" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "timelineDays" INTEGER,
ADD COLUMN     "website" TEXT;
-- AlterTable
ALTER TABLE "pipelines" ADD COLUMN     "kind" "PipelineKind" NOT NULL DEFAULT 'OPPORTUNITY';
-- CreateTable
CREATE TABLE "lead_activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "LeadActivityType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "body" TEXT,
    "metadata" JSONB,
    "callOutcome" "CallOutcome",
    "callDisposition" "CallDisposition",
    "callDurationSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "lead_follow_ups" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "outcome" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lead_follow_ups_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "lead_score_configs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "budgetAvailableWeight" INTEGER NOT NULL DEFAULT 25,
    "decisionMakerWeight" INTEGER NOT NULL DEFAULT 20,
    "urgentRequirementWeight" INTEGER NOT NULL DEFAULT 20,
    "clearRequirementWeight" INTEGER NOT NULL DEFAULT 15,
    "shortTimelineWeight" INTEGER NOT NULL DEFAULT 10,
    "goodBusinessFitWeight" INTEGER NOT NULL DEFAULT 10,
    "shortTimelineDays" INTEGER NOT NULL DEFAULT 30,
    "hotThreshold" INTEGER NOT NULL DEFAULT 80,
    "warmThreshold" INTEGER NOT NULL DEFAULT 50,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lead_score_configs_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "lead_activities_leadId_createdAt_idx" ON "lead_activities"("leadId", "createdAt");
-- CreateIndex
CREATE INDEX "lead_activities_organizationId_actorId_createdAt_idx" ON "lead_activities"("organizationId", "actorId", "createdAt");
-- CreateIndex
CREATE INDEX "lead_activities_organizationId_type_createdAt_idx" ON "lead_activities"("organizationId", "type", "createdAt");
-- CreateIndex
CREATE INDEX "lead_follow_ups_organizationId_assigneeId_status_dueAt_idx" ON "lead_follow_ups"("organizationId", "assigneeId", "status", "dueAt");
-- CreateIndex
CREATE INDEX "lead_follow_ups_leadId_dueAt_idx" ON "lead_follow_ups"("leadId", "dueAt");
-- CreateIndex
CREATE UNIQUE INDEX "lead_score_configs_organizationId_key" ON "lead_score_configs"("organizationId");
-- CreateIndex
CREATE INDEX "leads_organizationId_stageId_idx" ON "leads"("organizationId", "stageId");
-- CreateIndex
CREATE INDEX "leads_organizationId_nextFollowUpAt_idx" ON "leads"("organizationId", "nextFollowUpAt");
-- CreateIndex
CREATE INDEX "leads_organizationId_score_idx" ON "leads"("organizationId", "score");
-- CreateIndex
CREATE INDEX "pipelines_organizationId_kind_idx" ON "pipelines"("organizationId", "kind");
-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "lead_score_configs" ADD CONSTRAINT "lead_score_configs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
