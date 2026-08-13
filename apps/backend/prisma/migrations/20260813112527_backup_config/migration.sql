-- CreateTable
CREATE TABLE "backup_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "endpoint" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "accessKeyId" TEXT NOT NULL,
    "secretAccessKey" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'auto',
    "intervalDays" INTEGER NOT NULL DEFAULT 3,
    "retainCount" INTEGER NOT NULL DEFAULT 2,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_config_pkey" PRIMARY KEY ("id")
);
