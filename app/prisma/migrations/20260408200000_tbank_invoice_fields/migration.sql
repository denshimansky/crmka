-- Добавляем поля для интеграции с Т-Банк API в billing_invoices

ALTER TABLE "billing_invoices" ADD COLUMN "paid_via" TEXT;
ALTER TABLE "billing_invoices" ADD COLUMN "tbank_invoice_id" TEXT;
ALTER TABLE "billing_invoices" ADD COLUMN "payment_url" TEXT;

-- Индекс для быстрого поиска по tbank_invoice_id (webhook)
CREATE INDEX "billing_invoices_tbank_invoice_id_idx" ON "billing_invoices"("tbank_invoice_id");
