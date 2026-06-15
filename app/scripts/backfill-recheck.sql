-- READ-ONLY перепроверка перед применением бэкфилла.
WITH live AS (
  SELECT s.tenant_id, s.group_id, s.client_id, s.ward_id, s.status, s.start_date
  FROM subscriptions s
  WHERE s.status IN ('pending','active') AND s.deleted_at IS NULL
)
SELECT
  -- (1) живой абонемент БЕЗ какой-либо записи зачисления — это бэкфиллим
  (SELECT count(*) FROM (
     SELECT 1 FROM live l
     WHERE NOT EXISTS (
       SELECT 1 FROM group_enrollments e
       WHERE e.tenant_id=l.tenant_id AND e.group_id=l.group_id
         AND e.client_id=l.client_id AND e.ward_id IS NOT DISTINCT FROM l.ward_id)
     GROUP BY l.tenant_id,l.group_id,l.client_id,l.ward_id
   ) m) AS missing_to_create,
  -- (2) живой абонемент, но зачисление есть и НЕ активно (isActive=false) —
  --     отдельная мутная история (ребёнок отчислён, но абонемент живой); НЕ трогаем
  (SELECT count(*) FROM (
     SELECT 1 FROM live l
     WHERE EXISTS (
       SELECT 1 FROM group_enrollments e
       WHERE e.tenant_id=l.tenant_id AND e.group_id=l.group_id
         AND e.client_id=l.client_id AND e.ward_id IS NOT DISTINCT FROM l.ward_id
         AND e.deleted_at IS NULL AND e.is_active=true)
     GROUP BY l.tenant_id,l.group_id,l.client_id,l.ward_id
   ) ok) AS already_active_enrollment,
  (SELECT count(*) FROM (
     SELECT 1 FROM live l
     WHERE NOT EXISTS (
       SELECT 1 FROM group_enrollments e
       WHERE e.tenant_id=l.tenant_id AND e.group_id=l.group_id
         AND e.client_id=l.client_id AND e.ward_id IS NOT DISTINCT FROM l.ward_id
         AND e.deleted_at IS NULL AND e.is_active=true)
     AND EXISTS (
       SELECT 1 FROM group_enrollments e2
       WHERE e2.tenant_id=l.tenant_id AND e2.group_id=l.group_id
         AND e2.client_id=l.client_id AND e2.ward_id IS NOT DISTINCT FROM l.ward_id)
     GROUP BY l.tenant_id,l.group_id,l.client_id,l.ward_id
   ) inactive) AS live_but_enrollment_inactive;
