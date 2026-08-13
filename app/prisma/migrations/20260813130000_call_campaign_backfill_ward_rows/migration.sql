-- Бэкфилл: развернуть легаси-строки обзвона «по клиенту» в строки «по подопечному».
-- До перехода 20260812120000_call_campaign_item_ward CallCampaignItem создавался
-- один на клиента (ward_id = NULL). Карточка кампании для такой строки показывает
-- одного «того самого» подопечного (fallback на wards[0]) — из-за чего у родителя
-- с несколькими детьми виден только один ребёнок, а строк на остальных нет.
--
-- Чиним УЖЕ существующие кампании: каждую НЕобработанную (pending) легаси-строку
-- (ward_id IS NULL) клиента, у которого есть подходящие под фильтр кампании
-- подопечные, заменяем на по одной pending-строке на каждого такого подопечного.
--   • фильтр по подопечному = дата рождения (birthFrom/birthTo) или легаси-возраст
--     (minAge/maxAge) из filter_criteria; без него подходят все подопечные;
--   • клиента без (подходящих) подопечных не трогаем — обзваниваем по контакту;
--   • обработанные строки (status <> 'pending') не трогаем — прогресс/история
--     важнее косметики отображения;
--   • кампании «этап-заявки» (funnelStatus ∈ application/trial_scheduled/
--     trial_attended/awaiting_payment) пропускаем: там разбивка сужается по
--     подопечному заявки (через UI «Обзвон по базам» недостижимо) — чинятся «Актуализировать».
--
-- Логика зеркалит wardIdsForClient/wardMatchesBirthFilter (lib/call-campaigns/filter.ts).
-- Идемпотентно: INSERT пропускает уже существующие тройки (кампания, клиент, ребёнок);
-- DELETE снимает только реально разбитые легаси-строки.

-- 1) Разворачиваем легаси-строки в строки-подопечные.
INSERT INTO "call_campaign_items"
  ("id", "tenant_id", "campaign_id", "client_id", "ward_id", "status", "created_at", "updated_at")
SELECT gen_random_uuid(), i."tenant_id", i."campaign_id", i."client_id", w."id", 'pending',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "call_campaign_items" i
JOIN "call_campaigns" c ON c."id" = i."campaign_id" AND c."deleted_at" IS NULL
JOIN "wards" w ON w."client_id" = i."client_id"
WHERE i."ward_id" IS NULL
  AND i."status" = 'pending'
  AND COALESCE(c."filter_criteria"->>'funnelStatus', '') NOT IN
      ('application', 'trial_scheduled', 'trial_attended', 'awaiting_payment')
  AND (
    CASE
      WHEN NULLIF(c."filter_criteria"->>'birthFrom','') IS NOT NULL
        OR NULLIF(c."filter_criteria"->>'birthTo','')   IS NOT NULL THEN
        w."birth_date" IS NOT NULL
        AND (NULLIF(c."filter_criteria"->>'birthFrom','') IS NULL
             OR w."birth_date" >= (c."filter_criteria"->>'birthFrom')::date)
        AND (NULLIF(c."filter_criteria"->>'birthTo','')   IS NULL
             OR w."birth_date" <= (c."filter_criteria"->>'birthTo')::date)
      WHEN NULLIF(c."filter_criteria"->>'minAge','') IS NOT NULL
        OR NULLIF(c."filter_criteria"->>'maxAge','') IS NOT NULL THEN
        w."birth_date" IS NOT NULL
        AND (NULLIF(c."filter_criteria"->>'minAge','') IS NULL
             OR w."birth_date" <= (CURRENT_DATE - ((c."filter_criteria"->>'minAge')::int * INTERVAL '1 year')))
        AND (NULLIF(c."filter_criteria"->>'maxAge','') IS NULL
             OR w."birth_date" >  (CURRENT_DATE - (((c."filter_criteria"->>'maxAge')::int + 1) * INTERVAL '1 year')))
      ELSE TRUE
    END
  )
  AND NOT EXISTS (
    SELECT 1 FROM "call_campaign_items" x
    WHERE x."campaign_id" = i."campaign_id"
      AND x."client_id" = i."client_id"
      AND x."ward_id" = w."id"
  );

-- 2) Снимаем легаси-строки, которые реально разбились (у клиента есть подходящие
--    подопечные). Строки клиентов без подходящих подопечных остаются как есть.
DELETE FROM "call_campaign_items" i
USING "call_campaigns" c
WHERE i."campaign_id" = c."id"
  AND c."deleted_at" IS NULL
  AND i."ward_id" IS NULL
  AND i."status" = 'pending'
  AND COALESCE(c."filter_criteria"->>'funnelStatus', '') NOT IN
      ('application', 'trial_scheduled', 'trial_attended', 'awaiting_payment')
  AND EXISTS (
    SELECT 1 FROM "wards" w
    WHERE w."client_id" = i."client_id"
      AND (
        CASE
          WHEN NULLIF(c."filter_criteria"->>'birthFrom','') IS NOT NULL
            OR NULLIF(c."filter_criteria"->>'birthTo','')   IS NOT NULL THEN
            w."birth_date" IS NOT NULL
            AND (NULLIF(c."filter_criteria"->>'birthFrom','') IS NULL
                 OR w."birth_date" >= (c."filter_criteria"->>'birthFrom')::date)
            AND (NULLIF(c."filter_criteria"->>'birthTo','')   IS NULL
                 OR w."birth_date" <= (c."filter_criteria"->>'birthTo')::date)
          WHEN NULLIF(c."filter_criteria"->>'minAge','') IS NOT NULL
            OR NULLIF(c."filter_criteria"->>'maxAge','') IS NOT NULL THEN
            w."birth_date" IS NOT NULL
            AND (NULLIF(c."filter_criteria"->>'minAge','') IS NULL
                 OR w."birth_date" <= (CURRENT_DATE - ((c."filter_criteria"->>'minAge')::int * INTERVAL '1 year')))
            AND (NULLIF(c."filter_criteria"->>'maxAge','') IS NULL
                 OR w."birth_date" >  (CURRENT_DATE - (((c."filter_criteria"->>'maxAge')::int + 1) * INTERVAL '1 year')))
          ELSE TRUE
        END
      )
  );

-- 3) Пересчитываем счётчики кампаний (всего/обработано) — self-healing после разбивки.
UPDATE "call_campaigns" c SET
  "total_items" = (SELECT count(*) FROM "call_campaign_items" i WHERE i."campaign_id" = c."id"),
  "completed_items" = (SELECT count(*) FROM "call_campaign_items" i
                       WHERE i."campaign_id" = c."id" AND i."status" <> 'pending')
WHERE c."deleted_at" IS NULL;
