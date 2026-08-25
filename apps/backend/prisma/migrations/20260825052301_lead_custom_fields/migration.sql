-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}';
