-- Placeholder-флаг для разовых посещений, добавленных через «Добавить ученика»
-- с чекбоксом «Разовое посещение». Такая Attendance ничего не списывает и не
-- начисляет, рендерится в UI как «Не отмечен». При первой реальной отметке
-- («Был» и т.п.) флаг сбрасывается в FALSE, attendance_type_id обновляется.
ALTER TABLE "attendances"
  ADD COLUMN "is_pending" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX "attendances_tenant_id_lesson_id_is_pending_idx"
  ON "attendances" ("tenant_id", "lesson_id", "is_pending");
