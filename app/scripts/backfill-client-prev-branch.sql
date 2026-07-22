-- Баг #79: бэкфилл двух последних РАЗНЫХ филиалов абонементов у существующих
-- клиентов (last_branch_id + prev_branch_id) из фактической истории.
--
-- Логика идентична lib/subscriptions/client-branches.ts:
--   «два последних РАЗНЫХ филиала» = два филиала, чья ПОСЛЕДНЯЯ выписка
--   (max created_at по абонементам этого филиала) — самая свежая.
--   Доказано эквивалентно инкрементальному shiftClientBranches и пакетному
--   twoRecentDistinctBranches (см. client-branches.test.ts).
--
-- Идемпотентно: можно перезапускать. Клиентов без абонементов не трогает
-- (у них нет истории; last/prev остаются как есть — обычно из импорта = branchId).
--
-- Применять на msk1 ПОСЛЕ деплоя миграции 20260722130000_add_client_prev_branch.
-- Прод мультитенантный — бэкфилл глобальный (джойн строго по client_id внутри
-- своей организации, tenant_id не смешивается).

-- === 1. Предпросмотр (dry-run): сколько клиентов получат второй филиал ===
WITH ranked AS (
  SELECT s.client_id, g.branch_id, MAX(s.created_at) AS last_created
  FROM subscriptions s
  JOIN groups g ON g.id = s.group_id
  WHERE s.deleted_at IS NULL AND g.branch_id IS NOT NULL
  GROUP BY s.client_id, g.branch_id
),
ordered AS (
  SELECT client_id, branch_id,
         ROW_NUMBER() OVER (
           PARTITION BY client_id ORDER BY last_created DESC, branch_id
         ) AS rn
  FROM ranked
)
SELECT
  COUNT(*) FILTER (WHERE rn = 1) AS clients_with_subs,
  COUNT(*) FILTER (WHERE rn = 2) AS clients_multi_branch
FROM ordered;

-- === 2. Бэкфилл ===
WITH ranked AS (
  SELECT s.client_id, g.branch_id, MAX(s.created_at) AS last_created
  FROM subscriptions s
  JOIN groups g ON g.id = s.group_id
  WHERE s.deleted_at IS NULL AND g.branch_id IS NOT NULL
  GROUP BY s.client_id, g.branch_id
),
ordered AS (
  SELECT client_id, branch_id,
         ROW_NUMBER() OVER (
           PARTITION BY client_id ORDER BY last_created DESC, branch_id
         ) AS rn
  FROM ranked
),
pairs AS (
  SELECT
    o1.client_id,
    o1.branch_id AS last_branch_id,
    o2.branch_id AS prev_branch_id
  FROM (SELECT client_id, branch_id FROM ordered WHERE rn = 1) o1
  LEFT JOIN (SELECT client_id, branch_id FROM ordered WHERE rn = 2) o2
    ON o2.client_id = o1.client_id
)
UPDATE clients c
SET last_branch_id = p.last_branch_id,
    prev_branch_id = p.prev_branch_id
FROM pairs p
WHERE c.id = p.client_id
  AND (c.last_branch_id IS DISTINCT FROM p.last_branch_id
    OR c.prev_branch_id IS DISTINCT FROM p.prev_branch_id);

-- === 3. Проверка: примеры мультифилиальных клиентов ===
SELECT c.id, c.last_name, c.first_name,
       bl.name AS last_branch, bp.name AS prev_branch
FROM clients c
LEFT JOIN branches bl ON bl.id = c.last_branch_id
LEFT JOIN branches bp ON bp.id = c.prev_branch_id
WHERE c.prev_branch_id IS NOT NULL
ORDER BY c.updated_at DESC
LIMIT 20;
