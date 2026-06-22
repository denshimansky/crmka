-- MUTATION (баг #40): отчисленные зачисления БЕЗ платных занятий — выставляем
-- withdrawn_at = enrolled_at, чтобы ребёнок не висел ни в одном занятии (в т.ч.
-- в «Неотмеченных»). Парный к коду fix в deactivate-enrollment.ts. Затрагивает
-- только уже отчисленные (is_active=false) зачисления детей с отчисленным
-- абонементом в группе и БЕЗ единого платного посещения (charge_amount > 0),
-- у которых сейчас withdrawn_at позже enrolled_at.
--
-- Скрипт содержит ТОЛЬКО UPDATE — транзакция на стороне запуска:
--   DRY-RUN:  (echo 'BEGIN;'; cat этот.sql; echo 'ROLLBACK;') | psql ...
--   ПРИМЕНИТЬ: (echo 'BEGIN;'; cat этот.sql; echo 'COMMIT;')   | psql ...

UPDATE group_enrollments ge
SET withdrawn_at = ge.enrolled_at
WHERE ge.deleted_at IS NULL
  AND ge.is_active = false
  AND ge.withdrawn_at > ge.enrolled_at
  AND EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.tenant_id = ge.tenant_id
      AND s.group_id  = ge.group_id
      AND s.client_id = ge.client_id
      AND s.ward_id IS NOT DISTINCT FROM ge.ward_id
      AND s.status = 'withdrawn'
      AND s.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM attendances a
    JOIN lessons l ON l.id = a.lesson_id
    WHERE a.tenant_id = ge.tenant_id
      AND l.group_id  = ge.group_id
      AND a.client_id = ge.client_id
      AND a.ward_id IS NOT DISTINCT FROM ge.ward_id
      AND a.charge_amount > 0
  );
