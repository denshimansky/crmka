-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('active', 'processed');

-- CreateEnum
CREATE TYPE "ApplicationOutcome" AS ENUM ('lead', 'potential', 'trial');

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "ward_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "direction_id" UUID NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'active',
    "processed_to_status" "ApplicationOutcome",
    "processed_at" TIMESTAMP(3),
    "processed_by" UUID,
    "comment" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "applications_tenant_id_status_idx" ON "applications"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "applications_tenant_id_client_id_status_idx" ON "applications"("tenant_id", "client_id", "status");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_direction_id_fkey" FOREIGN KEY ("direction_id") REFERENCES "directions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
