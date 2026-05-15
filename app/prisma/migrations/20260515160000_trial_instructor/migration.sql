-- Индивидуальный пробник: выбор инструктора (как «Педагог» в настройках группы).
ALTER TABLE "trial_lessons" ADD COLUMN "instructor_id" UUID;

ALTER TABLE "trial_lessons"
  ADD CONSTRAINT "trial_lessons_instructor_id_fkey"
  FOREIGN KEY ("instructor_id") REFERENCES "employees"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "trial_lessons_tenant_instructor_idx"
  ON "trial_lessons"("tenant_id", "instructor_id", "scheduled_date");
