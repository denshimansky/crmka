-- C8: системный тип «Назначена отработка» + блокировка флагов

-- 1. Флаг блокировки изменений в AttendanceType
ALTER TABLE "attendance_types"
  ADD COLUMN "is_flags_locked" BOOLEAN NOT NULL DEFAULT false;

-- 2. Поле на Attendance: куда назначена отработка пропущенного занятия
ALTER TABLE "attendances"
  ADD COLUMN "scheduled_makeup_lesson_id" UUID;

ALTER TABLE "attendances"
  ADD CONSTRAINT "attendances_scheduled_makeup_lesson_id_fkey"
    FOREIGN KEY ("scheduled_makeup_lesson_id") REFERENCES "lessons"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "attendances_tenant_id_scheduled_makeup_lesson_id_idx"
  ON "attendances"("tenant_id", "scheduled_makeup_lesson_id");

-- 3. Добавляем системную строку «Назначена отработка». Если уже есть — оставляем.
INSERT INTO "attendance_types" (
  "id", "tenant_id", "name", "code",
  "charges_subscription", "pays_instructor", "counts_as_revenue",
  "available_to_instructor", "part_of_plan", "part_of_fact", "part_of_forecast",
  "charge_percent", "is_system", "is_flags_locked", "is_active", "sort_order", "created_at"
)
SELECT gen_random_uuid(), NULL, 'Назначена отработка', 'makeup_scheduled',
       false, false, false,
       true, true, false, false,
       100, true, true, true, 3, NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "attendance_types" WHERE "code" = 'makeup_scheduled' AND "tenant_id" IS NULL
);

-- 4. Лочим флаги у обоих «технических» типов — их жёсткая семантика на бизнес-логике.
UPDATE "attendance_types"
SET "is_flags_locked" = true
WHERE "code" IN ('makeup', 'makeup_scheduled') AND "is_system" = true;
