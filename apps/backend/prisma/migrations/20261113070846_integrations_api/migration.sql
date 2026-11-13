-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REVOKED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "integration_credentials" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastFour" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "secretLastFour" TEXT NOT NULL,
    "secretRotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "events" TEXT[],
    "status" "WebhookStatus" NOT NULL DEFAULT 'ACTIVE',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telephony_providers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "secretLastFour" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "fieldMap" JSONB NOT NULL,
    "statusMap" JSONB NOT NULL,
    "eventsReceived" INTEGER NOT NULL DEFAULT 0,
    "eventsRejected" INTEGER NOT NULL DEFAULT 0,
    "lastEventAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telephony_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_call_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerId" TEXT,
    "source" TEXT NOT NULL,
    "providerCallId" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "phoneOriginal" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "phoneLast10" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "employeeId" TEXT,
    "leadId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_call_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_credentials_tokenHash_key" ON "integration_credentials"("tokenHash");

-- CreateIndex
CREATE INDEX "integration_credentials_organizationId_idx" ON "integration_credentials"("organizationId");

-- CreateIndex
CREATE INDEX "webhook_endpoints_organizationId_idx" ON "webhook_endpoints"("organizationId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_nextAttemptAt_idx" ON "webhook_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpointId_createdAt_idx" ON "webhook_deliveries"("endpointId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_endpointId_eventId_key" ON "webhook_deliveries"("endpointId", "eventId");

-- CreateIndex
CREATE INDEX "telephony_providers_organizationId_idx" ON "telephony_providers"("organizationId");

-- CreateIndex
CREATE INDEX "provider_call_events_organizationId_receivedAt_idx" ON "provider_call_events"("organizationId", "receivedAt");

-- CreateIndex
CREATE INDEX "provider_call_events_providerId_receivedAt_idx" ON "provider_call_events"("providerId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_call_events_organizationId_dedupKey_key" ON "provider_call_events"("organizationId", "dedupKey");

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_call_events" ADD CONSTRAINT "provider_call_events_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "telephony_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
