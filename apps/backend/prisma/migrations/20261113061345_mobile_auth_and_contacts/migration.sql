-- CreateEnum
CREATE TYPE "MobileAuthTokenKind" AS ENUM ('ACCESS', 'REFRESH');

-- CreateEnum
CREATE TYPE "MobileContactStatus" AS ENUM ('IMPORTED', 'LINKED', 'SKIPPED');

-- AlterTable
ALTER TABLE "mobile_devices" ADD COLUMN     "appVersion" TEXT,
ADD COLUMN     "enrollment" TEXT NOT NULL DEFAULT 'ADMIN',
ADD COLUMN     "platform" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "contactRetentionDays" INTEGER;

-- CreateTable
CREATE TABLE "mobile_auth_tokens" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "MobileAuthTokenKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_contacts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sourceKeyHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "company" TEXT,
    "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phones" JSONB NOT NULL DEFAULT '[]',
    "phoneLast10" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contentHash" TEXT NOT NULL,
    "status" "MobileContactStatus" NOT NULL,
    "leadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mobile_auth_tokens_tokenHash_key" ON "mobile_auth_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "mobile_auth_tokens_deviceId_idx" ON "mobile_auth_tokens"("deviceId");

-- CreateIndex
CREATE INDEX "mobile_auth_tokens_employeeId_idx" ON "mobile_auth_tokens"("employeeId");

-- CreateIndex
CREATE INDEX "mobile_auth_tokens_familyId_idx" ON "mobile_auth_tokens"("familyId");

-- CreateIndex
CREATE INDEX "mobile_contacts_organizationId_employeeId_idx" ON "mobile_contacts"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "mobile_contacts_organizationId_phoneLast10_idx" ON "mobile_contacts"("organizationId", "phoneLast10");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_contacts_organizationId_deviceId_sourceKeyHash_key" ON "mobile_contacts"("organizationId", "deviceId", "sourceKeyHash");

-- AddForeignKey
ALTER TABLE "mobile_auth_tokens" ADD CONSTRAINT "mobile_auth_tokens_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "mobile_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_contacts" ADD CONSTRAINT "mobile_contacts_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "mobile_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_contacts" ADD CONSTRAINT "mobile_contacts_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
