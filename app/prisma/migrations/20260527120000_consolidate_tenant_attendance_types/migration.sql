-- C17: чистим tenant-specific дубли системных типов посещений.
--
-- На dev legacy-типы (absent_excused/absent_unexcused/recalc/sick/trial)
-- и копии канонических (present/makeup) сидят с tenant_id != null.
-- При этом глобальных канонических present/makeup могло вообще не быть —
-- старая seed-логика не вставляла их если уже был tenant-specific.
-- Поэтому сначала создаём недостающие глобальные канонические, потом
-- через CTE мигрируем Attendance и удаляем дубли.

-- 0. Досев недостающих канонических — на случай если их нет с tenant_id IS NULL.

INSERT INTO "attendance_types" (
  "id", "tenant_id", "name", "code",
  "charges_subscription", "pays_instructor", "counts_as_revenue",
  "available_to_instructor", "available_to_admin",
  "part_of_plan", "part_of_fact", "part_of_forecast",
  "charge_percent", "is_system", "is_flags_locked", "is_active", "sort_order", "created_at"
)
SELECT gen_random_uuid(), NULL, 'Был', 'present',
       true, true, true,
       true, true, true, true, true,
       100, true, true, true, 1, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "attendance_types" WHERE code='present' AND tenant_id IS NULL);

INSERT INTO "attendance_types" (
  "id", "tenant_id", "name", "code",
  "charges_subscription", "pays_instructor", "counts_as_revenue",
  "available_to_instructor", "available_to_admin",
  "part_of_plan", "part_of_fact", "part_of_forecast",
  "charge_percent", "is_system", "is_flags_locked", "is_active", "sort_order", "created_at"
)
SELECT gen_random_uuid(), NULL, 'Отработка', 'makeup',
       false, false, false,
       false, false, false, true, false,
       100, true, true, true, 7, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "attendance_types" WHERE code='makeup' AND tenant_id IS NULL);

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

-- 2. Legacy-коды → канонические аналоги.
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
  "is_trial" = CASE WHEN m.legacy_code = 'trial' THEN true ELSE a."is_trial" END
FROM id_map m
WHERE a."attendance_type_id" = m.old_id;

DELETE FROM "attendance_types"
WHERE code IN ('absent_excused', 'absent_unexcused', 'recalc', 'sick', 'trial');
