-- Этап воронки продаж переезжает на Ward: один родитель может вести нескольких детей
-- через разные стадии (один на пробном, другой уже «ждём оплату»). Client.funnelStatus
-- остаётся только как качество контакта (new/active_client/potential/non_target/archived/blacklisted).

-- CreateEnum
CREATE TYPE "WardSalesStage" AS ENUM ('none', 'application', 'trial_scheduled', 'trial_attended', 'awaiting_payment');

-- AddColumns
ALTER TABLE "wards"
  ADD COLUMN "sales_stage"    "WardSalesStage" NOT NULL DEFAULT 'none',
  ADD COLUMN "sales_stage_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "wards_tenant_id_sales_stage_idx" ON "wards"("tenant_id", "sales_stage");

-- Бэкфилл: переносим продажные стадии из Client.funnelStatus во ВСЕ Ward родителя.
-- salesStageAt = updatedAt родителя (приближение момента смены статуса).
UPDATE "wards" w
SET
  "sales_stage" = CASE c."funnel_status"
    WHEN 'trial_scheduled'  THEN 'trial_scheduled'::"WardSalesStage"
    WHEN 'trial_attended'   THEN 'trial_attended'::"WardSalesStage"
    WHEN 'awaiting_payment' THEN 'awaiting_payment'::"WardSalesStage"
  END,
  "sales_stage_at" = c."updated_at"
FROM "clients" c
WHERE w."client_id" = c."id"
  AND c."funnel_status" IN ('trial_scheduled', 'trial_attended', 'awaiting_payment');

-- Backfill для Ward с активной заявкой: ставим application, если ещё none.
UPDATE "wards" w
SET
  "sales_stage" = 'application'::"WardSalesStage",
  "sales_stage_at" = a."created_at"
FROM "applications" a
WHERE a."ward_id" = w."id"
  AND a."status" = 'active'
  AND a."deleted_at" IS NULL
  AND w."sales_stage" = 'none';

-- После переноса продажные стадии родителю больше не нужны — переводим их в 'new'.
-- active_client / potential / non_target / archived / blacklisted не трогаем.
UPDATE "clients"
SET "funnel_status" = 'new'::"FunnelStatus"
WHERE "funnel_status" IN ('trial_scheduled', 'trial_attended', 'awaiting_payment');
