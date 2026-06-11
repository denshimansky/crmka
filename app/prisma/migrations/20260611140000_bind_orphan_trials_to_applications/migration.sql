-- Привязка пробных без заявки (application_id IS NULL) к заявкам.
-- Бэкфилл funnel_per_application матчил только по ward+направлению и пропустил
-- ~половину исторических пробных (в т.ч. без ward_id) — отчёт «Воронка продаж»
-- видит пробные только через заявку, поэтому добиваем привязку там, где она
-- однозначна. Новые пробные без заявки текущими потоками не создаются.

-- 1. Прошедшие пробные (attended / no_show) — история, уникальный индекс
--    scheduled-пробных не затрагивают. Привязываем по ward, если у ребёнка
--    ровно одна не-удалённая заявка.
UPDATE "trial_lessons" t
SET "application_id" = a."id"
FROM (
  SELECT "ward_id", MIN("id"::text)::uuid AS "id"
  FROM "applications"
  WHERE "deleted_at" IS NULL AND "ward_id" IS NOT NULL
  GROUP BY "ward_id"
  HAVING COUNT(*) = 1
) a
WHERE t."application_id" IS NULL
  AND t."status" IN ('attended', 'no_show')
  AND t."ward_id" = a."ward_id";

-- 2. То же для пробных без ward_id — по клиенту, если у клиента ровно одна
--    не-удалённая заявка.
UPDATE "trial_lessons" t
SET "application_id" = a."id"
FROM (
  SELECT "client_id", MIN("id"::text)::uuid AS "id"
  FROM "applications"
  WHERE "deleted_at" IS NULL
  GROUP BY "client_id"
  HAVING COUNT(*) = 1
) a
WHERE t."application_id" IS NULL
  AND t."ward_id" IS NULL
  AND t."status" IN ('attended', 'no_show')
  AND t."client_id" = a."client_id";

-- 3. Запланированные (scheduled) пробные-сироты: привязываем с защитой
--    уникального индекса trial_lessons_application_scheduled_uniq — только если
--    у целевой заявки ещё нет scheduled-пробного, и не больше одного на заявку
--    (берём самое позднее по дате).
WITH candidates AS (
  SELECT
    t."id" AS trial_id,
    a."id" AS app_id,
    ROW_NUMBER() OVER (
      PARTITION BY a."id"
      ORDER BY t."scheduled_date" DESC, t."created_at" DESC
    ) AS rn
  FROM "trial_lessons" t
  JOIN (
    SELECT "ward_id", MIN("id"::text)::uuid AS "id"
    FROM "applications"
    WHERE "deleted_at" IS NULL AND "ward_id" IS NOT NULL
    GROUP BY "ward_id"
    HAVING COUNT(*) = 1
  ) a ON a."ward_id" = t."ward_id"
  WHERE t."application_id" IS NULL
    AND t."status" = 'scheduled'
    AND NOT EXISTS (
      SELECT 1 FROM "trial_lessons" x
      WHERE x."application_id" = a."id" AND x."status" = 'scheduled'
    )
)
UPDATE "trial_lessons" t
SET "application_id" = c.app_id
FROM candidates c
WHERE t."id" = c.trial_id AND c.rn = 1;
