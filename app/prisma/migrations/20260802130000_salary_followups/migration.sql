-- Доработки зарплатных выплат по код-ревью фичи оклад-твина.

-- #3: связь премии/штрафа с выплатой. Премии/штрафы, внесённые тем же «Документом
-- выплат», линкуются к выплате сотрудника. ON DELETE CASCADE → аннулирование выплаты
-- (DELETE /api/salary-payments/[id]) само убирает эти премии/штрафы, и «Осталось»
-- в ведомости остаётся корректным. Standalone-корректировки (внесённые отдельно,
-- без выплаты) имеют salary_payment_id = NULL и аннулированием не затрагиваются.
ALTER TABLE "salary_adjustments" ADD COLUMN "salary_payment_id" UUID;

ALTER TABLE "salary_adjustments"
  ADD CONSTRAINT "salary_adjustments_salary_payment_id_fkey"
  FOREIGN KEY ("salary_payment_id") REFERENCES "salary_payments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "salary_adjustments_salary_payment_id_idx" ON "salary_adjustments" ("salary_payment_id");

-- #4: партиал-UNIQUE системных категорий расходов по имени (tenant_id IS NULL).
-- Защищает getOkladCategoryId (findFirst+create) от гонки, задваивающей категорию
-- «Зарплата окладников» на свежей БД. Категории тенантов (tenant_id NOT NULL) не
-- затрагиваются. Прод msk1 проверен 02.08.2026: дублей системных имён нет.
-- Partial-UNIQUE выражается только сырым SQL (Prisma-схема их не описывает) — как
-- kb_sections_slug_active_key / organizations_inn_unique.
CREATE UNIQUE INDEX "expense_categories_system_name_key" ON "expense_categories" ("name") WHERE "tenant_id" IS NULL;
