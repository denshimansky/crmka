-- DRY-RUN (только чтение): сколько GroupEnrollment не хватает для живых абонементов.
-- Логика идентична scripts/backfill-group-enrollments.ts.
WITH live AS (
  SELECT s.tenant_id, s.group_id, s.client_id, s.ward_id, s.status, s.start_date
  FROM subscriptions s
  WHERE s.status IN ('pending','active') AND s.deleted_at IS NULL
),
missing AS (
  SELECT l.tenant_id, l.group_id, l.client_id, l.ward_id,
         bool_or(l.status = 'active') AS any_active,
         min(l.start_date)            AS enrolled_at,
         count(*)                     AS live_subs
  FROM live l
  WHERE NOT EXISTS (
    SELECT 1 FROM group_enrollments e
    WHERE e.tenant_id = l.tenant_id
      AND e.group_id  = l.group_id
      AND e.client_id = l.client_id
      AND e.ward_id IS NOT DISTINCT FROM l.ward_id
  )
  GROUP BY l.tenant_id, l.group_id, l.client_id, l.ward_id
)
SELECT
  (SELECT count(*) FROM live)                                   AS live_subs_total,
  (SELECT count(*) FROM missing)                                AS enrollments_to_create,
  (SELECT count(*) FILTER (WHERE any_active) FROM missing)      AS as_active,
  (SELECT count(*) FILTER (WHERE NOT any_active) FROM missing)  AS as_awaiting_payment;

-- Образец первых 15 записей, которые будут созданы:
WITH live AS (
  SELECT s.tenant_id, s.group_id, s.client_id, s.ward_id, s.status, s.start_date
  FROM subscriptions s
  WHERE s.status IN ('pending','active') AND s.deleted_at IS NULL
)
SELECT l.tenant_id, l.group_id, l.client_id, l.ward_id,
       bool_or(l.status='active') AS any_active,
       (CASE WHEN bool_or(l.status='active') THEN 'active' ELSE 'awaiting_payment' END) AS payment_status,
       min(l.start_date) AS enrolled_at,
       count(*) AS live_subs
FROM live l
WHERE NOT EXISTS (
  SELECT 1 FROM group_enrollments e
  WHERE e.tenant_id = l.tenant_id AND e.group_id = l.group_id
    AND e.client_id = l.client_id AND e.ward_id IS NOT DISTINCT FROM l.ward_id
)
GROUP BY l.tenant_id, l.group_id, l.client_id, l.ward_id
LIMIT 15;
