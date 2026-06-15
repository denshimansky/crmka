-- APPLY: реактивирует зачисления, у которых is_active=false, но есть живой
-- (pending/active) абонемент той же связки (group, client, ward). См. dry-run.
--
-- На каждую связку реактивируем ОДНУ запись (самую свежую по enrolled_at):
--   is_active=true, withdrawn_at=NULL,
--   payment_status = active, если хотя бы один живой абонемент активен, иначе
--   awaiting_payment.
-- enrolled_at НЕ трогаем — сохраняем фактическую дату зачисления (ребёнок
-- появится в расписании с неё, а не с 1-го числа — согласуется с багом #8).
-- Идемпотентно: после прогона у связки есть активное зачисление => в выборку
-- больше не попадает.
BEGIN;

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
),
pick AS (
  SELECT DISTINCT ON (e.tenant_id, e.group_id, e.client_id, e.ward_id)
         e.id, g.any_active
  FROM gap g
  JOIN group_enrollments e
    ON e.tenant_id = g.tenant_id AND e.group_id = g.group_id
   AND e.client_id = g.client_id AND e.ward_id IS NOT DISTINCT FROM g.ward_id
   AND e.is_active = false AND e.deleted_at IS NULL
  ORDER BY e.tenant_id, e.group_id, e.client_id, e.ward_id,
           e.enrolled_at DESC, e.created_at DESC
)
UPDATE group_enrollments e
SET is_active     = true,
    withdrawn_at  = NULL,
    payment_status = (CASE WHEN p.any_active THEN 'active' ELSE 'awaiting_payment' END)::"EnrollmentPaymentStatus",
    updated_at    = now()
FROM pick p
WHERE e.id = p.id;

COMMIT;
