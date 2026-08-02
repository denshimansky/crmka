-- Доработка по код-ревью фичи оклад-твина.

-- Партиал-UNIQUE системных категорий расходов по имени (tenant_id IS NULL).
-- Защищает getOkladCategoryId (findFirst+create) от гонки, задваивающей категорию
-- «Зарплата окладников» на свежей БД. Категории тенантов (tenant_id NOT NULL) не
-- затрагиваются. Прод msk1 проверен 02.08.2026: дублей системных имён нет.
-- Partial-UNIQUE выражается только сырым SQL (Prisma-схема их не описывает) — как
-- kb_sections_slug_active_key / organizations_inn_unique.
CREATE UNIQUE INDEX "expense_categories_system_name_key" ON "expense_categories" ("name") WHERE "tenant_id" IS NULL;
