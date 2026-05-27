-- C17: чистим tenant-specific дубли системных типов посещений.
--
-- Реальная проблема: на dev legacy-типы (absent_excused/absent_unexcused/
-- recalc/sick/trial) и копии канонических (present/makeup) сидят с
-- tenant_id != null. Прошлая миграция C16 искала только tenant_id IS NULL,
-- поэтому ничего не сработало.

-- 1. Tenant-specific дубли с теми же кодами, что у канонических глобальных
-- (present, no_show, excused, absent, recalculation, makeup, makeup_scheduled).
-- Перепривязываем Attendance на глобальный канон и удаляем локальный дубль.
UPDATE "attendances" a
SET "attendance_type_id" = g.id
FROM "attendance_types" local
JOIN "attendance_types" g ON g.code = local.code AND g.tenant_id IS NULL
WHERE a."attendance_type_id" = local.id
  AND local.tenant_id IS NOT NULL
  AND local.code IN ('present', 'no_show', 'excused', 'absent', 'recalculation', 'makeup', 'makeup_scheduled');

DELETE FROM "attendance_types" local
WHERE local.tenant_id IS NOT NULL
  AND local.code IN ('present', 'no_show', 'excused', 'absent', 'recalculation', 'makeup', 'makeup_scheduled')
  AND EXISTS (
    SELECT 1 FROM "attendance_types" g WHERE g.code = local.code AND g.tenant_id IS NULL
  );

-- 2. Legacy-коды → канонические аналоги.

-- absent_excused → excused (Уваж. пропуск)
UPDATE "attendances" a
SET "attendance_type_id" = g.id
FROM "attendance_types" g
WHERE g.code = 'excused' AND g.tenant_id IS NULL
  AND a."attendance_type_id" IN (
    SELECT id FROM "attendance_types" WHERE code = 'absent_excused'
  );

DELETE FROM "attendance_types" WHERE code = 'absent_excused';

-- absent_unexcused → absent (Прогул)
UPDATE "attendances" a
SET "attendance_type_id" = g.id
FROM "attendance_types" g
WHERE g.code = 'absent' AND g.tenant_id IS NULL
  AND a."attendance_type_id" IN (
    SELECT id FROM "attendance_types" WHERE code = 'absent_unexcused'
  );

DELETE FROM "attendance_types" WHERE code = 'absent_unexcused';

-- recalc → recalculation (Перерасчёт)
UPDATE "attendances" a
SET "attendance_type_id" = g.id
FROM "attendance_types" g
WHERE g.code = 'recalculation' AND g.tenant_id IS NULL
  AND a."attendance_type_id" IN (
    SELECT id FROM "attendance_types" WHERE code = 'recalc'
  );

DELETE FROM "attendance_types" WHERE code = 'recalc';

-- sick → excused (Болезнь — это AbsenceReason, не тип посещения)
UPDATE "attendances" a
SET "attendance_type_id" = g.id
FROM "attendance_types" g
WHERE g.code = 'excused' AND g.tenant_id IS NULL
  AND a."attendance_type_id" IN (
    SELECT id FROM "attendance_types" WHERE code = 'sick'
  );

DELETE FROM "attendance_types" WHERE code = 'sick';

-- trial → present + is_trial=true (для пробных есть отдельная сущность TrialLesson)
UPDATE "attendances" a
SET "attendance_type_id" = g.id, "is_trial" = true
FROM "attendance_types" g
WHERE g.code = 'present' AND g.tenant_id IS NULL
  AND a."attendance_type_id" IN (
    SELECT id FROM "attendance_types" WHERE code = 'trial'
  );

DELETE FROM "attendance_types" WHERE code = 'trial';
