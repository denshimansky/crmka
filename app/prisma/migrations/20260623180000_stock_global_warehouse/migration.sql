-- Общий склад: одна локация на организацию. Раньше «склад» был привязан к филиалу
-- (stock_balances). Теперь товар живёт в трёх местах: общий склад (warehouse_balances)
-- + филиал (stock_balances) + кабинет (room_balances). Внесение товара денег не
-- двигает (расход в ДДС/ОПИУ не создаётся) — склад чисто информационный.

-- 1. Флаги «общий склад» в журнале движений (у общего склада нет своего id).
ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "from_warehouse" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "to_warehouse"   BOOLEAN NOT NULL DEFAULT false;

-- 2. Таблица остатков общего склада: один остаток на (tenant, товар).
CREATE TABLE IF NOT EXISTS "warehouse_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "stock_item_id" UUID NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "warehouse_balances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_balances_tenant_id_stock_item_id_key" ON "warehouse_balances"("tenant_id", "stock_item_id");
CREATE INDEX IF NOT EXISTS "warehouse_balances_tenant_id_idx" ON "warehouse_balances"("tenant_id");

-- ADD CONSTRAINT не поддерживает IF NOT EXISTS — оборачиваем в guard, чтобы вся
-- миграция была безопасно перезапускаемой (на msk1 деплой раньше падал по таймауту).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_balances_tenant_id_fkey') THEN
    ALTER TABLE "warehouse_balances" ADD CONSTRAINT "warehouse_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_balances_stock_item_id_fkey') THEN
    ALTER TABLE "warehouse_balances" ADD CONSTRAINT "warehouse_balances_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_items"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. Перенос данных: существующие остатки филиалов (stock_balances) суммируем
--    в общий склад по (tenant, товар). Филиалы после перехода стартуют пустыми —
--    товар попадает в них только перемещением со склада.
INSERT INTO "warehouse_balances" ("id", "tenant_id", "stock_item_id", "quantity", "total_cost", "updated_at")
SELECT gen_random_uuid(), "tenant_id", "stock_item_id", SUM("quantity"), SUM("total_cost"), CURRENT_TIMESTAMP
FROM "stock_balances"
GROUP BY "tenant_id", "stock_item_id"
ON CONFLICT ("tenant_id", "stock_item_id")
DO UPDATE SET "quantity"   = "warehouse_balances"."quantity"   + EXCLUDED."quantity",
              "total_cost" = "warehouse_balances"."total_cost" + EXCLUDED."total_cost";

DELETE FROM "stock_balances";
