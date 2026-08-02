-- Целостность учётных данных сотрудников (инцидент ДЦ Easy 02.08.2026: у одного
-- человека две учётки с одинаковым email в разном регистре → вход по email уводил
-- в чужую учётку; плюс регистрозависимый логин). До сих пор уникальность держалась
-- только прикладными проверками (check-then-insert) — TOCTOU-гонка и рассинхрон.
--
-- Политика (решение владельца 02.08.2026):
--   • ЛОГИН — уникален ГЛОБАЛЬНО (вход по логину ищет по всей системе),
--     регистро-/пробелонезависимо → lower(btrim(login));
--   • EMAIL — уникален В РАМКАХ ЦЕНТРА (один email может числиться в разных орг.,
--     напр. владелец нескольких центров), регистро-/пробелонезависимо →
--     (tenant_id, lower(btrim(email))), только где email задан.
--
-- Партиал/функциональные индексы через raw SQL — Prisma-схема их не выражает
-- (как organizations_inn_unique, kb_*_slug_active_key). Приложение нормализует и
-- проверяет уникальность до вставки (lib/employee-identity.ts); БД — жёсткая
-- гарантия. Матчинг при входе (auth.ts) — тем же lower(trim()).
--
-- Прод (msk1) и dev (Hetzner) проверены 02.08.2026: 0 глобальных дублей логина,
-- 0 внутрицентровых дублей email (после чистки: обнуление не-владельческих
-- дублей email по 4 центрам + 3 переименования логинов).

CREATE UNIQUE INDEX "employees_login_lower_active_key"
  ON "employees" (lower(btrim("login")))
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "employees_tenant_email_lower_active_key"
  ON "employees" ("tenant_id", lower(btrim("email")))
  WHERE "deleted_at" IS NULL AND "email" IS NOT NULL;
