-- Бэкфил 08.08.2026: сброс зависшего Client.firstPaidLessonDate.
-- До фикса removeApplicationFromFunnel не пересчитывал агрегат при soft-delete
-- заявки. Если заявку из «Ожидаем оплату» (с проставленной «датой 1-го платного»)
-- потом удаляли/выводили из воронки, дата зависала на клиенте, и wasEverClient
-- навсегда считал его «бывшим клиентом» — нельзя было вернуть в «Потенциальный»
-- (только «В Выбывшие»), хотя ни оплат, ни платных занятий не было.
--
-- Зеркалит recomputeClientFirstPaidLessonDate: значение = min по ЖИВЫМ заявкам
-- (Application.firstPaidLessonDate, deleted_at IS NULL) + первому платному
-- посещению (Attendance.chargeAmount > 0). Здесь очищаем ТОЛЬКО клиентов, у
-- которых ни того, ни другого источника не осталось → корректный recompute = NULL.
-- Клиентов с живым источником не трогаем (их значение верно). Идемпотентно.
-- Ожидаемый охват на msk1: ~16 клиентов (Dream, «Умные дети», «Умный Я», Class, Easy).

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE stale_fpld AS
SELECT c.id AS client_id, c.tenant_id, c.first_paid_lesson_date AS old_date
FROM clients c
WHERE c.first_paid_lesson_date IS NOT NULL
  AND c.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM applications a
    WHERE a.client_id = c.id AND a.deleted_at IS NULL
      AND a.first_paid_lesson_date IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM attendances att
    WHERE att.client_id = c.id AND att.charge_amount > 0
  );

-- Guard + референс для отката (старые значения по клиентам).
SELECT * FROM stale_fpld;

UPDATE clients c
SET first_paid_lesson_date = NULL, updated_at = now()
WHERE c.id IN (SELECT client_id FROM stale_fpld);

-- Контроль после (ожидается 0 строк).
SELECT c.id, c.first_paid_lesson_date
FROM clients c
JOIN stale_fpld s ON s.client_id = c.id
WHERE c.first_paid_lesson_date IS NOT NULL;

COMMIT;
