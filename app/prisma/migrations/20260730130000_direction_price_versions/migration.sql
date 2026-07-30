-- Запланированные будущие изменения цены направления (баг #88).
-- Каждая строка — полный снимок прайс-блока направления, вступающий в силу с
-- effectiveFrom (сравнивается с Subscription.startDate). Базовые поля
-- "directions" остаются «живой» ценой; крон-промоутер
-- (app/src/lib/cron/promote-direction-prices.ts) переносит наступившую версию в
-- "directions" и ставит applied_at. Аддитивно.
CREATE TABLE "direction_prices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "direction_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "lesson_price" DECIMAL(12,2) NOT NULL,
    "trial_price" DECIMAL(12,2),
    "trial_free" BOOLEAN NOT NULL DEFAULT false,
    "single_visit_price" DECIMAL(12,2),
    "package_prices" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "applied_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "direction_prices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "direction_prices_tenant_id_direction_id_effective_from_idx"
    ON "direction_prices"("tenant_id", "direction_id", "effective_from");

ALTER TABLE "direction_prices"
    ADD CONSTRAINT "direction_prices_direction_id_fkey"
    FOREIGN KEY ("direction_id") REFERENCES "directions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
