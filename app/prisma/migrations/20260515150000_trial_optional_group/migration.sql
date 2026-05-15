-- Пробник теперь может быть индивидуальным (без группы).
-- Если групп нет — нужны явные direction, start_time, duration_minutes.

-- Группа становится опциональной
ALTER TABLE "trial_lessons" ALTER COLUMN "group_id" DROP NOT NULL;

-- Новые поля для индивидуального пробника
ALTER TABLE "trial_lessons" ADD COLUMN "direction_id" UUID;
ALTER TABLE "trial_lessons" ADD COLUMN "start_time" TEXT;
ALTER TABLE "trial_lessons" ADD COLUMN "duration_minutes" INTEGER;

-- FK на directions
ALTER TABLE "trial_lessons"
  ADD CONSTRAINT "trial_lessons_direction_id_fkey"
  FOREIGN KEY ("direction_id") REFERENCES "directions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
