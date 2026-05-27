-- C16: убрать legacy-дубли системных типов посещений.
--
-- На dev исторически создавались собственные системные типы с другими
-- кодами (absent_excused / absent_unexcused / recalc / trial / sick).
-- После Ф1-Ф3 у нас 7 канонических системных типов с понятными кодами:
--   present, no_show, makeup_scheduled, excused, absent, recalculation, makeup.
-- Эта миграция переключает все привязанные Attendance с legacy-кодов на
-- канонические аналоги и удаляет дубли. Если канонического типа нет
-- (например, миграция запускается на пустой БД), DELETE / UPDATE
-- безопасно ничего не делают благодаря AND EXISTS-проверке.

-- 1. absent_excused → excused (Уваж. пропуск)
UPDATE "attendances" SET "attendance_type_id" = (
  SELECT id FROM "attendance_types" WHERE code = 'excused' AND tenant_id IS NULL LIMIT 1
)
WHERE "attendance_type_id" IN (
  SELECT id FROM "attendance_types" WHERE code = 'absent_excused' AND tenant_id IS NULL
)
AND EXISTS (SELECT 1 FROM "attendance_types" WHERE code = 'excused' AND tenant_id IS NULL);

DELETE FROM "attendance_types"
WHERE code = 'absent_excused' AND tenant_id IS NULL
  AND EXISTS (SELECT 1 FROM "attendance_types" WHERE code = 'excused' AND tenant_id IS NULL);

-- 2. absent_unexcused → absent (Прогул)
UPDATE "attendances" SET "attendance_type_id" = (
  SELECT id FROM "attendance_types" WHERE code = 'absent' AND tenant_id IS NULL LIMIT 1
)
WHERE "attendance_type_id" IN (
  SELECT id FROM "attendance_types" WHERE code = 'absent_unexcused' AND tenant_id IS NULL
)
AND EXISTS (SELECT 1 FROM "attendance_types" WHERE code = 'absent' AND tenant_id IS NULL);

DELETE FROM "attendance_types"
WHERE code = 'absent_unexcused' AND tenant_id IS NULL
  AND EXISTS (SELECT 1 FROM "attendance_types" WHERE code = 'absent' AND tenant_id IS NULL);

-- 3. recalc → recalculation (Перерасчёт)
UPDATE "attendances" SET "attendance_type_id" = (
  SELECT id FROM "attendance_types" WHERE code = 'recalculation' AND tenant_id IS NULL LIMIT 1
)
WHERE "attendance_type_id" IN (
  SELECT id FROM "attendance_types" WHERE code = 'recalc' AND tenant_id IS NULL
)
AND EXISTS (SELECT 1 FROM "attendance_types" WHERE code = 'recalculation' AND tenant_id IS NULL);

DELETE FROM "attendance_types"
WHERE code = 'recalc' AND tenant_id IS NULL
  AND EXISTS (SELECT 1 FROM "attendance_types" WHERE code = 'recalculation' AND tenant_id IS NULL);

-- 4. sick → excused (Болезнь должна быть причиной AbsenceReason, не типом).
-- Перепривязываем Attendance на Уваж. пропуск и удаляем legacy-тип.
UPDATE "attendances" SET "attendance_type_id" = (
  SELECT id FROM "attendance_types" WHERE code = 'excused' AND tenant_id IS NULL LIMIT 1
)
WHERE "attendance_type_id" IN (
  SELECT id FROM "attendance_types" WHERE code = 'sick' AND tenant_id IS NULL
)
AND EXISTS (SELECT 1 FROM "attendance_types" WHERE code = 'excused' AND tenant_id IS NULL);

DELETE FROM "attendance_types"
WHERE code = 'sick' AND tenant_id IS NULL
  AND EXISTS (SELECT 1 FROM "attendance_types" WHERE code = 'excused' AND tenant_id IS NULL);

-- 5. trial → present + isTrial=true (пробное — это отдельная сущность TrialLesson,
-- но если кто-то отметил так Attendance, конвертируем в обычное «Был» с флагом isTrial).
UPDATE "attendances" SET
  "attendance_type_id" = (
    SELECT id FROM "attendance_types" WHERE code = 'present' AND tenant_id IS NULL LIMIT 1
  ),
  "is_trial" = true
WHERE "attendance_type_id" IN (
  SELECT id FROM "attendance_types" WHERE code = 'trial' AND tenant_id IS NULL
)
AND EXISTS (SELECT 1 FROM "attendance_types" WHERE code = 'present' AND tenant_id IS NULL);

DELETE FROM "attendance_types"
WHERE code = 'trial' AND tenant_id IS NULL
  AND EXISTS (SELECT 1 FROM "attendance_types" WHERE code = 'present' AND tenant_id IS NULL);
