-- Воронка продаж переезжает с Ward на Application: этап (stage) теперь у каждой заявки.
-- У одного ребёнка может быть несколько заявок на разных этапах одновременно
-- (1 «Заявка» + 1 «Пробное» + 1 «Ожидаем оплату»). Ward.salesStage остаётся
-- денормализованным зеркалом = максимальный этап среди активных заявок ребёнка.

-- 1. Новый исход заявки: оплачена (выигрыш, уходит из воронки).
ALTER TYPE "ApplicationOutcome" ADD VALUE IF NOT EXISTS 'won';

-- 2. Этап у заявки.
ALTER TABLE "applications"
  ADD COLUMN "stage" "WardSalesStage" NOT NULL DEFAULT 'application';

CREATE INDEX "applications_tenant_id_status_stage_idx" ON "applications"("tenant_id", "status", "stage");

-- 3. Связь пробного с конкретной заявкой.
ALTER TABLE "trial_lessons"
  ADD COLUMN "application_id" UUID;

CREATE INDEX "trial_lessons_tenant_id_application_id_idx" ON "trial_lessons"("tenant_id", "application_id");

ALTER TABLE "trial_lessons" ADD CONSTRAINT "trial_lessons_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- БЭКОФИЛЛ существующих данных (best-effort; данных мало — MVP/пилот).
-- Цель: каждый ребёнок в воронке должен иметь активную заявку с верным этапом,
-- чтобы строки «Продаж» = активные заявки и никто не исчез из воронки.
-- ============================================================================

-- A. Привязываем не-отменённые пробные к заявке того же ребёнка и направления.
--    Предпочитаем заявку, по которой пробное и заводилось (processed_to_status='trial').
UPDATE "trial_lessons" tl
SET "application_id" = sub.app_id
FROM (
  SELECT t."id" AS trial_id,
    (SELECT a."id" FROM "applications" a
       WHERE a."tenant_id" = t."tenant_id"
         AND a."ward_id" = t."ward_id"
         AND a."direction_id" = COALESCE(t."direction_id", g."direction_id")
         AND a."deleted_at" IS NULL
       ORDER BY (a."processed_to_status" = 'trial') DESC, a."created_at" DESC
       LIMIT 1) AS app_id
  FROM "trial_lessons" t
  LEFT JOIN "groups" g ON g."id" = t."group_id"
  WHERE t."ward_id" IS NOT NULL
    AND t."status" <> 'cancelled'
) sub
WHERE tl."id" = sub.trial_id
  AND sub.app_id IS NOT NULL;

-- B1. Заявки с привязанным живым пробным → переоткрываем (если были закрыты под
--     пробное) и ставим этап: attended → trial_attended, иначе (scheduled/no_show)
--     → trial_scheduled. Только для ward, чьё зеркало ещё на пробной стадии.
UPDATE "applications" a
SET "status"             = 'active',
    "processed_to_status" = CASE WHEN a."processed_to_status" = 'trial' THEN NULL ELSE a."processed_to_status" END,
    "processed_at"        = CASE WHEN a."processed_to_status" = 'trial' THEN NULL ELSE a."processed_at" END,
    "processed_by"        = CASE WHEN a."processed_to_status" = 'trial' THEN NULL ELSE a."processed_by" END,
    "stage"              = CASE WHEN best."attended" THEN 'trial_attended'::"WardSalesStage"
                                ELSE 'trial_scheduled'::"WardSalesStage" END
FROM (
  SELECT tl."application_id" AS app_id, bool_or(tl."status" = 'attended') AS "attended"
  FROM "trial_lessons" tl
  WHERE tl."application_id" IS NOT NULL AND tl."status" <> 'cancelled'
  GROUP BY tl."application_id"
) best,
"wards" w
WHERE a."id" = best.app_id
  AND a."ward_id" = w."id"
  AND w."sales_stage" IN ('trial_scheduled', 'trial_attended')
  AND a."deleted_at" IS NULL;

-- B2. «Ожидаем оплату»: ward в awaiting_payment с pending-абонементом — переоткрываем
--     заявку того же направления и ставим этап awaiting_payment (move-to-awaiting
--     раньше закрывал её как 'lead').
UPDATE "applications" a
SET "status"             = 'active',
    "processed_to_status" = NULL,
    "processed_at"        = NULL,
    "processed_by"        = NULL,
    "stage"              = 'awaiting_payment'::"WardSalesStage"
FROM "wards" w, "subscriptions" s
WHERE a."ward_id" = w."id"
  AND w."sales_stage" = 'awaiting_payment'
  AND s."ward_id" = w."id"
  AND s."status" = 'pending'
  AND s."direction_id" = a."direction_id"
  AND a."deleted_at" IS NULL;

-- B3. Страховка от исчезновения: если у ward в воронке не осталось ни одной активной
--     заявки, переоткрываем последнюю не-удалённую заявку и ставим этап = зеркалу ward
--     (branch/direction уже на заявке — синтетику не создаём).
UPDATE "applications" a
SET "status"             = 'active',
    "processed_to_status" = NULL,
    "processed_at"        = NULL,
    "processed_by"        = NULL,
    "stage"              = w."sales_stage"
FROM "wards" w
WHERE a."ward_id" = w."id"
  AND w."sales_stage" IN ('trial_scheduled', 'trial_attended', 'awaiting_payment')
  AND a."deleted_at" IS NULL
  AND a."id" = (
    SELECT a2."id" FROM "applications" a2
    WHERE a2."ward_id" = w."id" AND a2."deleted_at" IS NULL
    ORDER BY (a2."status" = 'active') DESC, a2."updated_at" DESC
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM "applications" a3
    WHERE a3."ward_id" = w."id" AND a3."status" = 'active' AND a3."deleted_at" IS NULL
  );
