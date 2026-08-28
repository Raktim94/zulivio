-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "leadId" TEXT,
ADD COLUMN     "opportunityId" TEXT;

-- CreateIndex
CREATE INDEX "assignments_leadId_idx" ON "assignments"("leadId");

-- CreateIndex
CREATE INDEX "assignments_opportunityId_idx" ON "assignments"("opportunityId");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
