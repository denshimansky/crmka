-- AlterTable
ALTER TABLE "salary_brackets" ADD COLUMN     "salary_rate_schedule_id" UUID;

-- CreateTable
CREATE TABLE "salary_rate_schedules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "salary_rate_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "scheme" "SalaryScheme" NOT NULL,
    "rate_per_student" DECIMAL(12,2),
    "rate_per_lesson" DECIMAL(12,2),
    "fixed_per_shift" DECIMAL(12,2),
    "percent_of_payments" DECIMAL(5,2),
    "trial_pay_mode" TEXT NOT NULL DEFAULT 'none',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "salary_rate_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salary_rate_schedules_tenant_id_salary_rate_id_effective_fr_idx" ON "salary_rate_schedules"("tenant_id", "salary_rate_id", "effective_from");

-- CreateIndex
CREATE INDEX "salary_brackets_tenant_id_salary_rate_schedule_id_idx" ON "salary_brackets"("tenant_id", "salary_rate_schedule_id");

-- AddForeignKey
ALTER TABLE "salary_rate_schedules" ADD CONSTRAINT "salary_rate_schedules_salary_rate_id_fkey" FOREIGN KEY ("salary_rate_id") REFERENCES "salary_rates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_brackets" ADD CONSTRAINT "salary_brackets_salary_rate_schedule_id_fkey" FOREIGN KEY ("salary_rate_schedule_id") REFERENCES "salary_rate_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

