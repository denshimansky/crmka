-- MUTATION: одноразовый пересчёт даты отчисления у уже отчисленных абонементов
-- по правилу «последнее платное занятие» (charge_amount > 0, max lesson.date).
--
-- Содержит ТОЛЬКО UPDATE-операторы (без BEGIN/COMMIT) — управление транзакцией
-- на стороне запуска:
--   DRY-RUN (откат):  (echo 'BEGIN;'; cat этот.sql; echo 'ROLLBACK;') | psql ...
--   ПРИМЕНИТЬ:        (echo 'BEGIN;'; cat этот.sql; echo 'COMMIT;')   | psql ...
--
-- Скоуп:
--   1) subscriptions.withdrawal_date = последнее платное занятие ИМЕННО этого
--      абонемента. Абонементы без платных посещений НЕ трогаются (нельзя
--      вычислить — остаются с прежней датой).
--   2) group_enrollments.withdrawn_at = (последнее платное занятие РЕБЁНКА в этой
--      группе, по всем его абонементам) + 1 день — граница состава: на последнем
--      платном занятии ребёнок виден, в более поздних — нет. Трогаем только уже
--      отчисленные (is_active=false) зачисления детей, у которых есть отчисленный
--      абонемент в этой группе.

-- 1) Абонементы.
WITH lp AS (
  SELECT a.subscription_id AS sub_id, MAX(l.date) AS d
  FROM attendances a
  JOIN lessons l ON l.id = a.lesson_id
  WHERE a.charge_amount > 0
  GROUP BY a.subscription_id
)
UPDATE subscriptions s
SET withdrawal_date = lp.d
FROM lp
WHERE lp.sub_id = s.id
  AND s.status = 'withdrawn'
  AND s.deleted_at IS NULL
  AND s.withdrawal_date IS DISTINCT FROM lp.d;

-- 2) Зачисления в группу.
WITH child_lp AS (
  SELECT a.tenant_id, l.group_id, a.client_id, a.ward_id, MAX(l.date) AS d
  FROM attendances a
  JOIN lessons l ON l.id = a.lesson_id
  WHERE a.charge_amount > 0
  GROUP BY a.tenant_id, l.group_id, a.client_id, a.ward_id
)
UPDATE group_enrollments ge
SET withdrawn_at = child_lp.d + 1
FROM child_lp
WHERE ge.tenant_id = child_lp.tenant_id
  AND ge.group_id  = child_lp.group_id
  AND ge.client_id = child_lp.client_id
  AND ge.ward_id IS NOT DISTINCT FROM child_lp.ward_id
  AND ge.is_active = false
  AND ge.deleted_at IS NULL
  AND ge.withdrawn_at IS NOT NULL
  AND ge.withdrawn_at IS DISTINCT FROM (child_lp.d + 1)
  -- только дети с отчисленным абонементом в этой группе (консервативный скоуп)
  AND EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.tenant_id = ge.tenant_id
      AND s.group_id  = ge.group_id
      AND s.client_id = ge.client_id
      AND s.ward_id IS NOT DISTINCT FROM ge.ward_id
      AND s.status = 'withdrawn'
      AND s.deleted_at IS NULL
  );
