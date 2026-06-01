-- Фундамент пакетного типа абонемента (PR #1 из плана reports-logic-md-lexical-lantern.md).
--
-- В этой миграции:
--   1. Organization: добавить subscription_type, subscription_type_locked_at, package_default_valid_days, package_expiry_notify_days_before.
--   2. Новая таблица package_templates (шаблоны пакетов 4/8/12 + срок).
--   3. Subscription: period_year/period_month -> nullable, добавить expires_at, package_template_id, новые индексы.
--   4. Бэкфилл: все организации, у которых уже есть subscriptions, фиксируем как calendar и блокируем тип.

-- === 1. Organization: новые поля ===========================================
ALTER TABLE "organizations"
  ADD COLUMN "subscription_type"                  "SubscriptionType",
  ADD COLUMN "subscription_type_locked_at"        TIMESTAMP(3),
  ADD COLUMN "package_default_valid_days"         INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "package_expiry_notify_days_before"  INTEGER NOT NULL DEFAULT 7;

-- === 2. package_templates ==================================================
CREATE TABLE "package_templates" (
  "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"     UUID         NOT NULL,
  "lessons_count" INTEGER      NOT NULL,
  "valid_days"    INTEGER,
  "is_active"     BOOLEAN      NOT NULL DEFAULT true,
  "sort_order"    INTEGER      NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  "deleted_at"    TIMESTAMP(3),
  CONSTRAINT "package_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "package_templates_tenant_id_is_active_idx"
  ON "package_templates"("tenant_id", "is_active");

ALTER TABLE "package_templates"
  ADD CONSTRAINT "package_templates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- === 3. Subscription: nullable period + новые поля =========================
ALTER TABLE "subscriptions"
  ALTER COLUMN "period_year"  DROP NOT NULL,
  ALTER COLUMN "period_month" DROP NOT NULL,
  ADD COLUMN "expires_at"           DATE,
  ADD COLUMN "package_template_id"  UUID;

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_package_template_id_fkey"
  FOREIGN KEY ("package_template_id") REFERENCES "package_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "subscriptions_tenant_type_status_expires_idx"
  ON "subscriptions"("tenant_id", "type", "status", "expires_at");

CREATE INDEX "subscriptions_tenant_client_group_type_status_idx"
  ON "subscriptions"("tenant_id", "client_id", "group_id", "type", "status");

-- === 4. Бэкфилл: organizations с уже существующими subscriptions ===========
-- Все, у кого есть данные, фиксируем как calendar и блокируем тип, чтобы wizard
-- не показывал шаг выбора на уже работающих тенантах. Новые orgs остаются с NULL —
-- wizard заполнит при онбординге.
UPDATE "organizations"
SET "subscription_type"           = 'calendar',
    "subscription_type_locked_at" = NOW()
WHERE "id" IN (
  SELECT DISTINCT "tenant_id" FROM "subscriptions" WHERE "deleted_at" IS NULL
);
