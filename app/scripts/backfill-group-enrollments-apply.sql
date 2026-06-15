-- APPLY: создаёт недостающие GroupEnrollment для живых (pending/active) абонементов.
-- Идемпотентно: фильтр NOT EXISTS => повторный прогон не создаёт дублей.
-- Один enrollment на (tenant, group, client, ward); payment_status=active если
-- хотя бы один живой абонемент этой связки активен, иначе awaiting_payment;
-- enrolled_at = минимальная start_date среди этих абонементов.
BEGIN;

INSERT INTO group_enrollments
  (id, tenant_id, group_id, client_id, ward_id, payment_status, is_active, enrolled_at, created_at, updated_at)
SELECT
  gen_random_uuid(),
  l.tenant_id, l.group_id, l.client_id, l.ward_id,
  (CASE WHEN bool_or(l.status = 'active') THEN 'active' ELSE 'awaiting_payment' END)::"EnrollmentPaymentStatus",
  true,
  min(l.start_date),
  now(), now()
FROM (
  SELECT s.tenant_id, s.group_id, s.client_id, s.ward_id, s.status, s.start_date
  FROM subscriptions s
  WHERE s.status IN ('pending','active') AND s.deleted_at IS NULL
) l
WHERE NOT EXISTS (
  SELECT 1 FROM group_enrollments e
  WHERE e.tenant_id = l.tenant_id
    AND e.group_id  = l.group_id
    AND e.client_id = l.client_id
    AND e.ward_id IS NOT DISTINCT FROM l.ward_id
)
GROUP BY l.tenant_id, l.group_id, l.client_id, l.ward_id;

COMMIT;
