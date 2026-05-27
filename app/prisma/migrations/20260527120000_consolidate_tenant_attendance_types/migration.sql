-- C17: чистим tenant-specific дубли системных типов посещений.
--
-- На dev legacy-типы (absent_excused/absent_unexcused/recalc/sick/trial)
-- и копии канонических (present/makeup) сидят с tenant_id != null.
-- Через CTE строим map старый_id → новый_канонический_id и одним
-- UPDATE-ом мигрируем все Attendance. После этого DELETE проходит,
-- т.к. FK-ссылок не остаётся.

-- 1. Tenant-specific дубли с теми же кодами, что у глобальных канонических.
WITH dup_map AS (
  SELECT local.id AS old_id, g.id AS new_id
  FROM "attendance_types" local
  INNER JOIN "attendance_types" g
    ON g.code = local.code AND g.tenant_id IS NULL
  WHERE local.tenant_id IS NOT NULL
    AND local.code IN (
      'present', 'no_show', 'excused', 'absent',
      'recalculation', 'makeup', 'makeup_scheduled'
    )
)
UPDATE "attendances" a
SET "attendance_type_id" = m.new_id
FROM dup_map m
WHERE a."attendance_type_id" = m.old_id;

DELETE FROM "attendance_types" t
WHERE t.tenant_id IS NOT NULL
  AND t.code IN (
    'present', 'no_show', 'excused', 'absent',
    'recalculation', 'makeup', 'makeup_scheduled'
  )
  AND EXISTS (
    SELECT 1 FROM "attendance_types" g WHERE g.code = t.code AND g.tenant_id IS NULL
  );

-- 2. Legacy-коды → канонические аналоги (карта переименований).
WITH legacy_map(legacy_code, target_code) AS (
  VALUES
    ('absent_excused',   'excused'),
    ('absent_unexcused', 'absent'),
    ('recalc',           'recalculation'),
    ('sick',             'excused'),
    ('trial',            'present')
),
id_map AS (
  SELECT old.id AS old_id, g.id AS new_id, old.code AS legacy_code
  FROM "attendance_types" old
  INNER JOIN legacy_map lm ON lm.legacy_code = old.code
  INNER JOIN "attendance_types" g ON g.code = lm.target_code AND g.tenant_id IS NULL
)
UPDATE "attendances" a
SET
  "attendance_type_id" = m.new_id,
  -- Для trial-типа дополнительно проставляем is_trial.
  "is_trial" = CASE WHEN m.legacy_code = 'trial' THEN true ELSE a."is_trial" END
FROM id_map m
WHERE a."attendance_type_id" = m.old_id;

DELETE FROM "attendance_types"
WHERE code IN ('absent_excused', 'absent_unexcused', 'recalc', 'sick', 'trial');
