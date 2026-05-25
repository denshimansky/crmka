-- AlterTable: расширение матрицы видов посещений
ALTER TABLE "attendance_types"
  ADD COLUMN "available_to_instructor" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "part_of_plan" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "part_of_fact" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "part_of_forecast" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "charge_percent" INTEGER NOT NULL DEFAULT 100;

-- Бэкфилл флагов для существующих системных строк
-- present (Был/Явка): доступен педагогу, План + Факт + Прогноз
UPDATE "attendance_types"
SET "available_to_instructor" = true,
    "part_of_plan" = true,
    "part_of_fact" = true,
    "part_of_forecast" = true,
    "name" = 'Был'
WHERE "code" = 'present' AND "is_system" = true;

-- absent (Прогул): только План + Прогноз
UPDATE "attendance_types"
SET "available_to_instructor" = false,
    "part_of_plan" = true,
    "part_of_fact" = false,
    "part_of_forecast" = true
WHERE "code" = 'absent' AND "is_system" = true;

-- recalculation (Перерасчёт): ничего не считается
UPDATE "attendance_types"
SET "available_to_instructor" = false,
    "part_of_plan" = false,
    "part_of_fact" = false,
    "part_of_forecast" = false
WHERE "code" = 'recalculation' AND "is_system" = true;

-- makeup (Отработка): Факт + Прогноз
UPDATE "attendance_types"
SET "available_to_instructor" = false,
    "part_of_plan" = false,
    "part_of_fact" = true,
    "part_of_forecast" = true,
    "charges_subscription" = true,
    "pays_instructor" = true,
    "counts_as_revenue" = true
WHERE "code" = 'makeup' AND "is_system" = true;
