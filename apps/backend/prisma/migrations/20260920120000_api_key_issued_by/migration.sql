-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN "issuedById" TEXT;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
