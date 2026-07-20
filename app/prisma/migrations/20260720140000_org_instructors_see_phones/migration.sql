-- Владелец может открыть педагогам (роль instructor) телефоны клиентов.
-- По умолчанию false — телефоны у инструктора замаскированы, как и было.
-- Nullable-default столбец → без рерайта таблицы, бэкфилл не нужен.

ALTER TABLE "organizations"
  ADD COLUMN "instructors_see_phones" BOOLEAN NOT NULL DEFAULT false;
