-- CreateEnum
CREATE TYPE "MobileDeviceStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "MobileCallType" AS ENUM ('INCOMING', 'OUTGOING', 'MISSED', 'REJECTED', 'BLOCKED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "callRetentionDays" INTEGER;

-- CreateTable
CREATE TABLE "mobile_devices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "status" "MobileDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "tokenHash" TEXT NOT NULL,
    "tokenLastFour" TEXT NOT NULL,
    "tokenRotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastTestAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastExternalCallId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_calls" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leadId" TEXT,
    "phoneNumberOriginal" TEXT NOT NULL,
    "phoneNumberNormalized" TEXT NOT NULL,
    "phoneLast10" TEXT NOT NULL,
    "contactName" TEXT,
    "callType" "MobileCallType" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "simSlot" TEXT,
    "simName" TEXT,
    "androidCallId" TEXT,
    "externalId" TEXT,
    "dedupKey" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'api',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mobile_devices_tokenHash_key" ON "mobile_devices"("tokenHash");

-- CreateIndex
CREATE INDEX "mobile_devices_organizationId_employeeId_idx" ON "mobile_devices"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_devices_organizationId_deviceKey_key" ON "mobile_devices"("organizationId", "deviceKey");

-- CreateIndex
CREATE INDEX "mobile_calls_organizationId_startedAt_idx" ON "mobile_calls"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "mobile_calls_organizationId_employeeId_startedAt_idx" ON "mobile_calls"("organizationId", "employeeId", "startedAt");

-- CreateIndex
CREATE INDEX "mobile_calls_organizationId_deviceId_startedAt_idx" ON "mobile_calls"("organizationId", "deviceId", "startedAt");

-- CreateIndex
CREATE INDEX "mobile_calls_organizationId_phoneLast10_idx" ON "mobile_calls"("organizationId", "phoneLast10");

-- CreateIndex
CREATE INDEX "mobile_calls_organizationId_callType_startedAt_idx" ON "mobile_calls"("organizationId", "callType", "startedAt");

-- CreateIndex
CREATE INDEX "mobile_calls_organizationId_leadId_startedAt_idx" ON "mobile_calls"("organizationId", "leadId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_calls_organizationId_dedupKey_key" ON "mobile_calls"("organizationId", "dedupKey");

-- AddForeignKey
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_calls" ADD CONSTRAINT "mobile_calls_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_calls" ADD CONSTRAINT "mobile_calls_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "mobile_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_calls" ADD CONSTRAINT "mobile_calls_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_calls" ADD CONSTRAINT "mobile_calls_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
