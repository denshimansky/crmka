-- DRY-RUN (только чтение): зачисления, которые НАДО реактивировать.
--
-- Дополняет backfill-group-enrollments (тот создаёт ОТСУТСТВУЮЩИЕ зачисления,
-- NOT EXISTS). Здесь — обратный пробел: у связки (group, client, ward) есть
-- живой (pending/active) абонемент, но зачисление существует и при этом
-- is_active=false (ребёнок «висит отчисленным», хотя абонемент жив). Источник —
-- отчисление с последующим повторным выписыванием абонемента ДО фикса 05e5db1
-- (который теперь реактивирует зачисление при создании абонемента).
--
-- На каждую связку реактивируем ОДНУ запись — самую свежую по enrolled_at.
WITH live AS (
  SELECT s.tenant_id, s.group_id, s.client_id, s.ward_id,
         bool_or(s.status = 'active') AS any_active,
         min(s.start_date)            AS min_start
  FROM subscriptions s
  WHERE s.status IN ('pending','active') AND s.deleted_at IS NULL
  GROUP BY s.tenant_id, s.group_id, s.client_id, s.ward_id
),
gap AS (
  SELECT l.* FROM live l
  WHERE NOT EXISTS (
    SELECT 1 FROM group_enrollments e
    WHERE e.tenant_id = l.tenant_id AND e.group_id = l.group_id
      AND e.client_id = l.client_id AND e.ward_id IS NOT DISTINCT FROM l.ward_id
      AND e.is_active = true AND e.deleted_at IS NULL)
),
pick AS (
  SELECT DISTINCT ON (e.tenant_id, e.group_id, e.client_id, e.ward_id)
         e.id, e.enrolled_at, e.payment_status AS old_pay, g.any_active
  FROM gap g
  JOIN group_enrollments e
    ON e.tenant_id = g.tenant_id AND e.group_id = g.group_id
   AND e.client_id = g.client_id AND e.ward_id IS NOT DISTINCT FROM g.ward_id
   AND e.is_active = false AND e.deleted_at IS NULL
  ORDER BY e.tenant_id, e.group_id, e.client_id, e.ward_id,
           e.enrolled_at DESC, e.created_at DESC
)
SELECT
  (SELECT count(*) FROM gap)                              AS combos_with_live_sub_no_active_enrollment,
  (SELECT count(*) FROM pick)                             AS enrollments_to_reactivate,
  (SELECT count(*) FROM pick WHERE any_active)            AS will_be_active,
  (SELECT count(*) FROM pick WHERE NOT any_active)        AS will_be_awaiting_payment;

-- Что именно будет реактивировано (по одному на связку):
WITH live AS (
  SELECT s.tenant_id, s.group_id, s.client_id, s.ward_id,
         bool_or(s.status = 'active') AS any_active
  FROM subscriptions s
  WHERE s.status IN ('pending','active') AND s.deleted_at IS NULL
  GROUP BY s.tenant_id, s.group_id, s.client_id, s.ward_id
),
gap AS (
  SELECT l.* FROM live l
  WHERE NOT EXISTS (
    SELECT 1 FROM group_enrollments e
    WHERE e.tenant_id = l.tenant_id AND e.group_id = l.group_id
      AND e.client_id = l.client_id AND e.ward_id IS NOT DISTINCT FROM l.ward_id
      AND e.is_active = true AND e.deleted_at IS NULL)
)
SELECT DISTINCT ON (e.tenant_id, e.group_id, e.client_id, e.ward_id)
       gr.name AS group_name,
       coalesce(w.last_name || ' ' || w.first_name, c.last_name || ' ' || c.first_name) AS who,
       left(e.id::text, 8) AS enrollment,
       e.enrolled_at, e.payment_status AS old_pay,
       (CASE WHEN g.any_active THEN 'active' ELSE 'awaiting_payment' END) AS new_pay
FROM gap g
JOIN group_enrollments e
  ON e.tenant_id = g.tenant_id AND e.group_id = g.group_id
 AND e.client_id = g.client_id AND e.ward_id IS NOT DISTINCT FROM g.ward_id
 AND e.is_active = false AND e.deleted_at IS NULL
JOIN groups gr ON gr.id = e.group_id
JOIN clients c ON c.id = e.client_id
LEFT JOIN wards w ON w.id = e.ward_id
ORDER BY e.tenant_id, e.group_id, e.client_id, e.ward_id,
         e.enrolled_at DESC, e.created_at DESC;
