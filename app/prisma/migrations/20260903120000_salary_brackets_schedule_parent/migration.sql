-- Плавающая матрица у версии ставки «с даты» (SalaryRateSchedule).
--
-- Миграция 20260731120000_add_salary_rate_schedule добавила salary_brackets.
-- salary_rate_schedule_id + FK, но НЕ обновила CHECK-констрейнт
-- salary_brackets_exactly_one_parent, созданный в 20260527100000: он считал
-- только два родителя (salary_rate_id, group_salary_rate_id) и требовал ровно
-- один непустой. Строка матрицы, привязанная к версии ставки, даёт по нему 0
-- родителей → insert падал, и POST /api/salary-rates/[id]/schedule отдавал 500
-- для схемы floating_by_students (обычные схемы без brackets сохранялись).
--
-- Расширяем XOR до трёх родителей. Констрейнт строго мягче прежнего для
-- существующих данных: на dev и prod 0 строк, нарушающих новое условие.
ALTER TABLE "salary_brackets" DROP CONSTRAINT IF EXISTS "salary_brackets_exactly_one_parent";

ALTER TABLE "salary_brackets"
  ADD CONSTRAINT "salary_brackets_exactly_one_parent"
  CHECK (
    (("salary_rate_id" IS NOT NULL)::int
      + ("group_salary_rate_id" IS NOT NULL)::int
      + ("salary_rate_schedule_id" IS NOT NULL)::int) = 1
  );
