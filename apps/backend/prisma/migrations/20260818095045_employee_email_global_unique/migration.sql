-- DropIndex
DROP INDEX "employees_organizationId_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");
