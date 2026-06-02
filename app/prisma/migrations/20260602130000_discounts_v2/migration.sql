-- 1. Новый enum категории шаблона скидки.
CREATE TYPE "DiscountKind" AS ENUM ('permanent', 'linked_sibling', 'linked_second_direction');

-- 2. Шаблоны скидок: добавляем kind и systemKey (для двух системных шаблонов).
ALTER TABLE "discount_templates"
  ADD COLUMN "kind" "DiscountKind" NOT NULL DEFAULT 'permanent',
  ADD COLUMN "system_key" TEXT;

-- Системные шаблоны уникальны в пределах тенанта по ключу.
CREATE UNIQUE INDEX "discount_templates_tenantId_systemKey_key"
  ON "discount_templates" ("tenant_id", "system_key");

-- 3. Discount: ссылка на шаблон + индекс под пересчёт.
ALTER TABLE "discounts"
  ADD COLUMN "template_id" UUID;

ALTER TABLE "discounts"
  ADD CONSTRAINT "discounts_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "discount_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "discounts_subscription_id_is_active_idx"
  ON "discounts" ("subscription_id", "is_active");

-- 4. Client: выбранный родителем шаблон.
ALTER TABLE "clients"
  ADD COLUMN "discount_template_id" UUID;

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_discount_template_id_fkey"
  FOREIGN KEY ("discount_template_id") REFERENCES "discount_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Разовые маркетинговые бонусы.
CREATE TABLE "bonus_discounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "amount" DECIMAL(12, 2) NOT NULL,
    "date" DATE NOT NULL,
    "comment" TEXT,
    "reason" TEXT NOT NULL,
    "responsible_id" UUID,
    "is_marketing" BOOLEAN NOT NULL DEFAULT false,
    "channel_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "bonus_discounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bonus_discounts_tenant_id_date_idx"
  ON "bonus_discounts" ("tenant_id", "date");

CREATE INDEX "bonus_discounts_tenant_id_client_id_idx"
  ON "bonus_discounts" ("tenant_id", "client_id");

ALTER TABLE "bonus_discounts"
  ADD CONSTRAINT "bonus_discounts_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bonus_discounts"
  ADD CONSTRAINT "bonus_discounts_responsible_id_fkey"
  FOREIGN KEY ("responsible_id") REFERENCES "employees"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bonus_discounts"
  ADD CONSTRAINT "bonus_discounts_channel_id_fkey"
  FOREIGN KEY ("channel_id") REFERENCES "lead_channels"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
