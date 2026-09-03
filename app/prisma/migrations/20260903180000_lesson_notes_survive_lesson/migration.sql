-- Заметка о ребёнке переживает удаление занятия.
--
-- Была ON DELETE CASCADE: удаление занятия без отметок (одиночный DELETE,
-- отмена дня, перестройка расписания) молча стирало комментарий оператора
-- («заболел», «уехали»), и в истории клиента от него не оставалось следа.
-- Теперь lesson_id обнуляется, а опорой служит снимок даты занятия.
--
-- Аддитивно: снятие NOT NULL и новая nullable-колонка существующие строки не
-- ломают; FK меняем на SET NULL.

ALTER TABLE "lesson_student_notes" ALTER COLUMN "lesson_id" DROP NOT NULL;
ALTER TABLE "lesson_student_notes" ADD COLUMN IF NOT EXISTS "lesson_date" DATE;

-- Снимок даты для уже существующих заметок (у их занятий она ещё есть).
UPDATE "lesson_student_notes" n
SET "lesson_date" = l."date"
FROM "lessons" l
WHERE l."id" = n."lesson_id" AND n."lesson_date" IS NULL;

ALTER TABLE "lesson_student_notes" DROP CONSTRAINT "lesson_student_notes_lesson_id_fkey";
ALTER TABLE "lesson_student_notes" ADD CONSTRAINT "lesson_student_notes_lesson_id_fkey"
    FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Лента истории клиента читает заметки по клиенту, а не только по занятию.
CREATE INDEX IF NOT EXISTS "lesson_student_notes_tenant_id_client_id_idx"
    ON "lesson_student_notes"("tenant_id", "client_id");
