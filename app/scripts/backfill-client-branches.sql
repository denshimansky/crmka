-- Бэкфилл ручных полей филиала клиента (модель Анны, 13.08.2026).
-- Для клиентов с ПУСТОЙ карточкой (branch_id IS NULL) заполняет branch_id и
-- second_branch_id из истории: абонементы + заявки + зачисления + пробные +
-- посещения. Правило:
--   1 филиал  → branch_id
--   2 филиала → branch_id (последний по активности, если известен) + second_branch_id
--   0         → пропуск (нет данных о филиале; действует правило пустых полей)
--   >2        → пропуск + вывод на согласование (см. секцию PREVIEW)
--
-- Требует уже применённой миграции 20260813120000_add_client_second_branch.
-- Запуск на прод — через SSH к crmka-db-1 (read-only preview → затем APPLY):
--   ssh ... "docker exec -i crmka-db-1 psql -U crmka -d crmka" < backfill-client-branches.sql
-- Тестовые тенанты исключены. Идемпотентно: повторный прогон не трогает уже
-- заполненные карточки (branch_id IS NULL в выборке).

-- Тестовые/демо базы, которые НЕ бэкфиллим.
\set test_tenant '''b23c3c91-d5bb-4ba9-9a1c-2a5877805bca'''

-- ======================= PREVIEW (read-only) =======================
-- Прогнать ПЕРВЫМ, свериться с ожиданиями, и только потом APPLY.

\echo === PREVIEW: распределение пустых карточек по числу филиалов из истории ===
WITH ec AS (
  SELECT c.id, c.tenant_id, c.last_branch_id FROM clients c
  WHERE c.deleted_at IS NULL AND c.branch_id IS NULL AND c.tenant_id <> :test_tenant::uuid
),
sig AS (
  SELECT ec.id AS cid, g.branch_id FROM ec JOIN subscriptions s ON s.client_id=ec.id JOIN groups g ON g.id=s.group_id WHERE g.branch_id IS NOT NULL
  UNION SELECT ec.id, a.branch_id FROM ec JOIN applications a ON a.client_id=ec.id WHERE a.branch_id IS NOT NULL
  UNION SELECT ec.id, g.branch_id FROM ec JOIN group_enrollments ge ON ge.client_id=ec.id JOIN groups g ON g.id=ge.group_id WHERE g.branch_id IS NOT NULL
  UNION SELECT ec.id, COALESCE(g.branch_id, r.branch_id) FROM ec JOIN trial_lessons tl ON tl.client_id=ec.id LEFT JOIN groups g ON g.id=tl.group_id LEFT JOIN rooms r ON r.id=tl.room_id WHERE COALESCE(g.branch_id, r.branch_id) IS NOT NULL
  UNION SELECT ec.id, g.branch_id FROM ec JOIN attendances at ON at.client_id=ec.id JOIN lessons l ON l.id=at.lesson_id JOIN groups g ON g.id=l.group_id WHERE g.branch_id IS NOT NULL
),
cnt AS (
  SELECT ec.id, count(DISTINCT sig.branch_id) AS n FROM ec LEFT JOIN sig ON sig.cid=ec.id GROUP BY ec.id
)
SELECT n AS distinct_branches,
       count(*) AS clients,
       CASE WHEN n=0 THEN 'пропуск (нет данных)' WHEN n<=2 THEN 'заполним' ELSE 'на согласование' END AS action
FROM cnt GROUP BY n ORDER BY n;

\echo === PREVIEW: список на согласование (>2 филиалов) ===
WITH ec AS (
  SELECT c.id, c.tenant_id FROM clients c
  WHERE c.deleted_at IS NULL AND c.branch_id IS NULL AND c.tenant_id <> :test_tenant::uuid
),
sig AS (
  SELECT ec.id AS cid, g.branch_id FROM ec JOIN subscriptions s ON s.client_id=ec.id JOIN groups g ON g.id=s.group_id WHERE g.branch_id IS NOT NULL
  UNION SELECT ec.id, a.branch_id FROM ec JOIN applications a ON a.client_id=ec.id WHERE a.branch_id IS NOT NULL
  UNION SELECT ec.id, g.branch_id FROM ec JOIN group_enrollments ge ON ge.client_id=ec.id JOIN groups g ON g.id=ge.group_id WHERE g.branch_id IS NOT NULL
  UNION SELECT ec.id, COALESCE(g.branch_id, r.branch_id) FROM ec JOIN trial_lessons tl ON tl.client_id=ec.id LEFT JOIN groups g ON g.id=tl.group_id LEFT JOIN rooms r ON r.id=tl.room_id WHERE COALESCE(g.branch_id, r.branch_id) IS NOT NULL
  UNION SELECT ec.id, g.branch_id FROM ec JOIN attendances at ON at.client_id=ec.id JOIN lessons l ON l.id=at.lesson_id JOIN groups g ON g.id=l.group_id WHERE g.branch_id IS NOT NULL
)
SELECT o.name AS org, c.last_name||' '||c.first_name AS client, c.phone,
       string_agg(DISTINCT b.name, ', ' ORDER BY b.name) AS branches
FROM sig JOIN clients c ON c.id=sig.cid JOIN organizations o ON o.id=c.tenant_id JOIN branches b ON b.id=sig.branch_id
GROUP BY o.name, c.id, c.last_name, c.first_name, c.phone
HAVING count(DISTINCT sig.branch_id) > 2
ORDER BY org, client;

-- ======================= APPLY =======================
-- Раскомментировать BEGIN/COMMIT и выполнить ПОСЛЕ сверки PREVIEW.
-- (по умолчанию завёрнуто в ROLLBACK — «сухой прогон» без записи.)

BEGIN;

-- Утверждённые ВРУЧНУЮ филиалы для клиентов с >2 филиалами в истории (решение
-- Ани, 13.08.2026). Пока один: Лилия Шарафутдинова (ДЦ Умный Я, +79021217793)
-- → ONLINE + С.ПОРТ (Н.ПОРТ исключён). EXISTS-гард: если названия филиалов не
-- совпадут — строка не трогается (защита от случайного обнуления).
UPDATE clients c
SET branch_id        = (SELECT id FROM branches b WHERE b.tenant_id = c.tenant_id AND b.name = 'ONLINE'  AND b.deleted_at IS NULL),
    second_branch_id = (SELECT id FROM branches b WHERE b.tenant_id = c.tenant_id AND b.name = 'С.ПОРТ'  AND b.deleted_at IS NULL)
WHERE c.tenant_id = '8e4f73c7-01ef-4296-893f-e49e286f81e9'
  AND c.deleted_at IS NULL
  AND regexp_replace(c.phone, '\D', '', 'g') LIKE '%9021217793'
  AND EXISTS (SELECT 1 FROM branches b WHERE b.tenant_id = c.tenant_id AND b.name = 'ONLINE' AND b.deleted_at IS NULL)
  AND EXISTS (SELECT 1 FROM branches b WHERE b.tenant_id = c.tenant_id AND b.name = 'С.ПОРТ' AND b.deleted_at IS NULL);

WITH ec AS (
  SELECT c.id, c.last_branch_id FROM clients c
  WHERE c.deleted_at IS NULL AND c.branch_id IS NULL AND c.tenant_id <> :test_tenant::uuid
),
sig AS (
  SELECT ec.id AS cid, g.branch_id FROM ec JOIN subscriptions s ON s.client_id=ec.id JOIN groups g ON g.id=s.group_id WHERE g.branch_id IS NOT NULL
  UNION SELECT ec.id, a.branch_id FROM ec JOIN applications a ON a.client_id=ec.id WHERE a.branch_id IS NOT NULL
  UNION SELECT ec.id, g.branch_id FROM ec JOIN group_enrollments ge ON ge.client_id=ec.id JOIN groups g ON g.id=ge.group_id WHERE g.branch_id IS NOT NULL
  UNION SELECT ec.id, COALESCE(g.branch_id, r.branch_id) FROM ec JOIN trial_lessons tl ON tl.client_id=ec.id LEFT JOIN groups g ON g.id=tl.group_id LEFT JOIN rooms r ON r.id=tl.room_id WHERE COALESCE(g.branch_id, r.branch_id) IS NOT NULL
  UNION SELECT ec.id, g.branch_id FROM ec JOIN attendances at ON at.client_id=ec.id JOIN lessons l ON l.id=at.lesson_id JOIN groups g ON g.id=l.group_id WHERE g.branch_id IS NOT NULL
),
agg AS (
  SELECT ec.id, ec.last_branch_id, array_agg(DISTINCT sig.branch_id) AS branches
  FROM ec JOIN sig ON sig.cid=ec.id
  GROUP BY ec.id, ec.last_branch_id
),
pick AS (
  SELECT id, branches,
         -- поле 1 = последний по активности филиал (last_branch_id), если он в
         -- наборе; иначе — первый из набора. Порядок на видимость не влияет.
         CASE WHEN last_branch_id = ANY(branches) THEN last_branch_id ELSE branches[1] END AS f1
  FROM agg
  WHERE array_length(branches, 1) BETWEEN 1 AND 2
)
UPDATE clients c
SET branch_id = pick.f1,
    second_branch_id = (SELECT b FROM unnest(pick.branches) AS b WHERE b <> pick.f1 LIMIT 1)
FROM pick
WHERE c.id = pick.id;

\echo === APPLY: заполнено карточек (в этой транзакции) ===
SELECT count(*) AS filled FROM clients
WHERE branch_id IS NOT NULL AND second_branch_id IS NOT NULL;

-- ROLLBACK по умолчанию (сухой прогон). Для реальной записи заменить на COMMIT.
ROLLBACK;
