-- Пропорциональный перерасчёт SaaS при смене числа филиалов внутри оплаченного
-- периода (3/6/12 мес; пропорция по дням). Рост филиалов → доплатный счёт,
-- снижение → кредит организации (credit_balance), гасящий следующий счёт.
-- Аудит каждого перерасчёта — billing_adjustments.
--
-- ADD VALUE к NotificationType в этой миграции в DML не используется (значение
-- billing_credit пишется только рантаймом приложения) — ограничение Postgres
-- «нельзя использовать новое enum-значение в той же транзакции» не затрагивается.

-- CreateEnum
CREATE TYPE "BillingAdjustmentKind" AS ENUM ('charge', 'credit');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'billing_credit';

-- AlterTable: nullable-безопасный DEFAULT 0, без блокировки/рерайта существующих строк
ALTER TABLE "billing_subscriptions"
  ADD COLUMN "credit_balance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable: признак доплатного счёта и учтённый в нём кредит (DEFAULT — без рерайта)
ALTER TABLE "billing_invoices"
  ADD COLUMN "is_adjustment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "credit_applied" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "billing_adjustments" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "BillingAdjustmentKind" NOT NULL,
    "old_branch_count" INTEGER NOT NULL,
    "new_branch_count" INTEGER NOT NULL,
    "old_monthly" DECIMAL(12,2) NOT NULL,
    "new_monthly" DECIMAL(12,2) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "remaining_days" INTEGER NOT NULL,
    "total_days" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "invoice_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_adjustments_subscription_id_idx" ON "billing_adjustments"("subscription_id");

-- CreateIndex
CREATE INDEX "billing_adjustments_organization_id_idx" ON "billing_adjustments"("organization_id");

-- AddForeignKey
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
