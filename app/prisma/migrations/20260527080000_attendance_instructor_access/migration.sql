-- C9: фикс доступа педагогов к типам посещений + досев недостающих системных строк.

-- 1. «Назначена отработка» — педагог не должен её ставить (это действие админа/владельца).
UPDATE "attendance_types"
SET "available_to_instructor" = false
WHERE "code" = 'makeup_scheduled' AND "is_system" = true;

-- 2. Досев недостающих системных строк. На dev исторически были другие коды
-- (absent_excused/absent_unexcused/recalc/trial/sick), их не трогаем —
-- владельцы сами решат, что с ними сделать через UI. Добавляем только то,
-- чего нет в нашей канонической матрице.
INSERT INTO "attendance_types" (
  "id", "tenant_id", "name", "code",
  "charges_subscription", "pays_instructor", "counts_as_revenue",
  "available_to_instructor", "part_of_plan", "part_of_fact", "part_of_forecast",
  "charge_percent", "is_system", "is_flags_locked", "is_active", "sort_order", "created_at"
)
SELECT gen_random_uuid(), NULL, 'Не был', 'no_show',
       true, false, true,
       true, true, false, true,
       100, true, false, true, 2, NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "attendance_types" WHERE "code" = 'no_show' AND "tenant_id" IS NULL
);

INSERT INTO "attendance_types" (
  "id", "tenant_id", "name", "code",
  "charges_subscription", "pays_instructor", "counts_as_revenue",
  "available_to_instructor", "part_of_plan", "part_of_fact", "part_of_forecast",
  "charge_percent", "is_system", "is_flags_locked", "is_active", "sort_order", "created_at"
)
SELECT gen_random_uuid(), NULL, 'Уваж. пропуск', 'excused',
       false, false, false,
       false, true, false, false,
       100, true, false, true, 4, NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "attendance_types" WHERE "code" = 'excused' AND "tenant_id" IS NULL
);

INSERT INTO "attendance_types" (
  "id", "tenant_id", "name", "code",
  "charges_subscription", "pays_instructor", "counts_as_revenue",
  "available_to_instructor", "part_of_plan", "part_of_fact", "part_of_forecast",
  "charge_percent", "is_system", "is_flags_locked", "is_active", "sort_order", "created_at"
)
SELECT gen_random_uuid(), NULL, 'Прогул', 'absent',
       true, true, true,
       false, true, false, true,
       100, true, false, true, 5, NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "attendance_types" WHERE "code" = 'absent' AND "tenant_id" IS NULL
);

INSERT INTO "attendance_types" (
  "id", "tenant_id", "name", "code",
  "charges_subscription", "pays_instructor", "counts_as_revenue",
  "available_to_instructor", "part_of_plan", "part_of_fact", "part_of_forecast",
  "charge_percent", "is_system", "is_flags_locked", "is_active", "sort_order", "created_at"
)
SELECT gen_random_uuid(), NULL, 'Перерасчёт', 'recalculation',
       false, false, false,
       false, false, false, false,
       100, true, false, true, 7, NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "attendance_types" WHERE "code" = 'recalculation' AND "tenant_id" IS NULL
);
