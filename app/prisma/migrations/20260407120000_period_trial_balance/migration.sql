-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('open', 'closed', 'reopened');

-- CreateEnum
CREATE TYPE "TrialStatus" AS ENUM ('scheduled', 'attended', 'no_show', 'cancelled');

-- CreateEnum
CREATE TYPE "BalanceTransactionType" AS ENUM ('payment_received', 'subscription_remainder', 'refund', 'correction', 'transfer_to_subscription');

-- CreateTable
CREATE TABLE "periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'open',
    "closed_at" TIMESTAMP(3),
    "closed_by" UUID,
    "reopened_at" TIMESTAMP(3),
    "reopened_by" UUID,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_lessons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "ward_id" UUID,
    "group_id" UUID NOT NULL,
    "lesson_id" UUID,
    "status" "TrialStatus" NOT NULL DEFAULT 'scheduled',
    "scheduled_date" DATE NOT NULL,
    "attended_at" TIMESTAMP(3),
    "comment" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trial_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_balance_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "type" "BalanceTransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "subscription_id" UUID,
    "payment_id" UUID,
    "comment" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_balance_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "periods_tenant_id_year_month_key" ON "periods"("tenant_id", "year", "month");

-- CreateIndex
CREATE INDEX "trial_lessons_tenant_id_client_id_idx" ON "trial_lessons"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "trial_lessons_tenant_id_group_id_scheduled_date_idx" ON "trial_lessons"("tenant_id", "group_id", "scheduled_date");

-- CreateIndex
CREATE INDEX "client_balance_transactions_tenant_id_client_id_idx" ON "client_balance_transactions"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "client_balance_transactions_tenant_id_created_at_idx" ON "client_balance_transactions"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "periods" ADD CONSTRAINT "periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "periods" ADD CONSTRAINT "periods_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "periods" ADD CONSTRAINT "periods_reopened_by_fkey" FOREIGN KEY ("reopened_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_lessons" ADD CONSTRAINT "trial_lessons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_lessons" ADD CONSTRAINT "trial_lessons_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_lessons" ADD CONSTRAINT "trial_lessons_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_lessons" ADD CONSTRAINT "trial_lessons_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_lessons" ADD CONSTRAINT "trial_lessons_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_balance_transactions" ADD CONSTRAINT "client_balance_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_balance_transactions" ADD CONSTRAINT "client_balance_transactions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_balance_transactions" ADD CONSTRAINT "client_balance_transactions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_balance_transactions" ADD CONSTRAINT "client_balance_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
