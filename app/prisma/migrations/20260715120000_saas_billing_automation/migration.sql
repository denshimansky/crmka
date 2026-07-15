-- SaaS-биллинг: автосчета 20-го числа, проверка оплаты по выписке Т-Банк,
-- автоблокировка 1-го числа (см. docs/billing-architecture.md).

-- Уведомление «выставлен счёт» (колокольчик владельца/управляющего, ссылка на PDF)
ALTER TYPE "NotificationType" ADD VALUE 'billing_invoice';

-- Исключение из автобиллинга (своя/тестовая организация):
-- счета не выставляются, автоблокировка не применяется.
ALTER TABLE "organizations" ADD COLUMN "billing_exempt" BOOLEAN NOT NULL DEFAULT false;

-- Идемпотентный поиск счёта подписки за период (крон генерации)
CREATE INDEX "billing_invoices_subscription_id_idx" ON "billing_invoices"("subscription_id");

-- Операции банковской выписки Т-Банк: operation_id — идемпотентность поллинга,
-- unmatched-записи — очередь на ручную разборку (частичная оплата, чужое юрлицо).
CREATE TYPE "BillingBankOpStatus" AS ENUM ('matched', 'unmatched');

CREATE TABLE "billing_bank_operations" (
    "id" UUID NOT NULL,
    "operation_id" TEXT NOT NULL,
    "operation_date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payer_name" TEXT,
    "payer_inn" TEXT,
    "payment_purpose" TEXT,
    "status" "BillingBankOpStatus" NOT NULL,
    "matched_invoice_ids" JSONB,
    "comment" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_bank_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_bank_operations_operation_id_key" ON "billing_bank_operations"("operation_id");

CREATE INDEX "billing_bank_operations_status_idx" ON "billing_bank_operations"("status");
