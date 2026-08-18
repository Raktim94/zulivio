-- CreateTable
CREATE TABLE "google_sheets_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "clientEmail" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_sheets_config_pkey" PRIMARY KEY ("id")
);
