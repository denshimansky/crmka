-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('superadmin', 'support', 'development', 'billing');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('active', 'grace_period', 'blocked');

-- CreateEnum
CREATE TYPE "BillingSubscriptionStatus" AS ENUM ('active', 'grace_period', 'blocked', 'cancelled');

-- CreateEnum
CREATE TYPE "BillingInvoiceStatus" AS ENUM ('pending', 'paid', 'overdue', 'cancelled');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "billing_status" "BillingStatus" NOT NULL DEFAULT 'active';
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "contact_person" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "admin_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "billing_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "price_per_branch" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "billing_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "BillingSubscriptionStatus" NOT NULL DEFAULT 'active',
    "branch_count" INTEGER NOT NULL DEFAULT 1,
    "monthly_amount" DECIMAL(12,2) NOT NULL,
    "next_payment_date" DATE NOT NULL,
    "grace_period_end" DATE,
    "blocked_at" TIMESTAMP(3),
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "billing_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "BillingInvoiceStatus" NOT NULL DEFAULT 'pending',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "paid_at" TIMESTAMP(3),
    "paid_amount" DECIMAL(12,2),
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "billing_invoices_number_key" ON "billing_invoices"("number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "billing_subscriptions_organization_id_idx" ON "billing_subscriptions"("organization_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "billing_invoices_organization_id_idx" ON "billing_invoices"("organization_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "billing_invoices_status_idx" ON "billing_invoices"("status");

-- AddForeignKey
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
