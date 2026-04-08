-- AlterTable: add billing period fields to billing_subscriptions
ALTER TABLE "billing_subscriptions"
  ADD COLUMN "billing_period_months" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "period_end_date" DATE;

-- AlterTable: add period fields to billing_invoices
ALTER TABLE "billing_invoices"
  ADD COLUMN "period_months" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "branch_count" INTEGER NOT NULL DEFAULT 1;
