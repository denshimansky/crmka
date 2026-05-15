-- Индивидуальный пробник: выбор кабинета (=> филиал производный от кабинета).
ALTER TABLE "trial_lessons" ADD COLUMN "room_id" UUID;

ALTER TABLE "trial_lessons"
  ADD CONSTRAINT "trial_lessons_room_id_fkey"
  FOREIGN KEY ("room_id") REFERENCES "rooms"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
