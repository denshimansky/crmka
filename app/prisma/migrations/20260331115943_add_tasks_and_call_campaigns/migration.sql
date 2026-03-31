-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('manual', 'auto');

-- CreateEnum
CREATE TYPE "TaskAutoTrigger" AS ENUM ('contact_date', 'trial_reminder', 'payment_due', 'birthday', 'absence', 'promised_payment', 'unmarked_lesson');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "CallCampaignStatus" AS ENUM ('active', 'closed', 'archived');

-- CreateEnum
CREATE TYPE "CallItemStatus" AS ENUM ('pending', 'called', 'no_answer', 'callback', 'completed');

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "TaskType" NOT NULL,
    "auto_trigger" "TaskAutoTrigger",
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "due_date" DATE NOT NULL,
    "assigned_to" UUID NOT NULL,
    "assigned_by" UUID,
    "client_id" UUID,
    "completed_at" TIMESTAMP(3),
    "completed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_campaigns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CallCampaignStatus" NOT NULL DEFAULT 'active',
    "filter_criteria" JSONB NOT NULL,
    "assigned_to" UUID,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "completed_items" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "call_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_campaign_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "status" "CallItemStatus" NOT NULL DEFAULT 'pending',
    "comment" TEXT,
    "result" TEXT,
    "called_by" UUID,
    "called_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_campaign_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_tenant_id_status_due_date_idx" ON "tasks"("tenant_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_assigned_to_idx" ON "tasks"("tenant_id", "assigned_to");

-- CreateIndex
CREATE INDEX "call_campaigns_tenant_id_idx" ON "call_campaigns"("tenant_id");

-- CreateIndex
CREATE INDEX "call_campaign_items_campaign_id_idx" ON "call_campaign_items"("campaign_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_campaign_items" ADD CONSTRAINT "call_campaign_items_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "call_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_campaign_items" ADD CONSTRAINT "call_campaign_items_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
