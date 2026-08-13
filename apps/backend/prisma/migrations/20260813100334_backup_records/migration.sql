-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'UPLOADING', 'VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "backup_records" (
    "id" TEXT NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'PENDING',
    "dbKey" TEXT,
    "uploadsKey" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_records_status_completedAt_idx" ON "backup_records"("status", "completedAt");
