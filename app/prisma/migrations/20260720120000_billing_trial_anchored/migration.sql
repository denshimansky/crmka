-- Bug #65: индивидуальный биллинг — 14-дневный тест + якорные даты оплаты.
-- Новое значение статуса подписки `trial` и два nullable-поля на подписке.
-- Поля nullable без default → метаданные, без блокировок/рерайта таблицы.
-- Бэкфилл НЕ требуется: существующие подписки остаются NULL = legacy «1-е число».
-- Значение `trial` в этой миграции не используется в DML (ограничение Postgres
-- «нельзя использовать новое enum-значение в той же транзакции» не затрагивается).

-- AlterEnum
ALTER TYPE "BillingSubscriptionStatus" ADD VALUE IF NOT EXISTS 'trial';

-- AlterTable
ALTER TABLE "billing_subscriptions"
  ADD COLUMN "billing_anchor_day" INTEGER,
  ADD COLUMN "trial_ends_at" DATE;
