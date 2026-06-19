-- «Дата 1-го платного» в воронке «Продаж» становится per-ребёнок/заявку.
-- Раньше ячейка писала Client.firstPaidLessonDate (поле родителя), из-за чего
-- правка в строке одного ребёнка «перетекала» во все строки родителя. Теперь
-- дата живёт на заявке, а Client.firstPaidLessonDate остаётся агрегатом для
-- отчётов (saleDate, отток, конверсия), пересчитываемым по min из заявок и
-- фактического первого платного посещения.
ALTER TABLE "applications" ADD COLUMN "first_paid_lesson_date" DATE;

-- Бэкфилл: переносим текущее значение родителя на его АКТИВНЫЕ заявки, чтобы
-- существующие строки воронки не потеряли уже введённую дату. Для родителей с
-- одним ребёнком это точное значение; для нескольких — повторяет прежнее общее
-- значение на каждую заявку (как было до фикса), но теперь правится независимо.
UPDATE "applications" a
SET "first_paid_lesson_date" = c."first_paid_lesson_date"
FROM "clients" c
WHERE a."client_id" = c."id"
  AND a."deleted_at" IS NULL
  AND a."status" = 'active'
  AND c."first_paid_lesson_date" IS NOT NULL;
