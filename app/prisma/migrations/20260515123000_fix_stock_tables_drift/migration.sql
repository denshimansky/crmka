-- Fix stock tables drift: предыдущая миграция (20260415140000_add_missing_columns)
-- создала stock_items/stock_balances/stock_movements/room_balances со старой
-- структурой, не соответствующей текущей Prisma-схеме. Все таблицы пустые,
-- безопасно пересоздать с правильной схемой.

DROP TABLE IF EXISTS "room_balances" CASCADE;
DROP TABLE IF EXISTS "stock_movements" CASCADE;
DROP TABLE IF EXISTS "stock_balances" CASCADE;
DROP TABLE IF EXISTS "stock_items" CASCADE;
DROP TYPE IF EXISTS "StockMovementType";

CREATE TYPE "StockMovementType" AS ENUM ('purchase', 'transfer_to_room', 'write_off');

CREATE TABLE "stock_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'шт',
    "default_unit_cost" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "stock_item_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "stock_item_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit_cost" DECIMAL(12,2),
    "total_cost" DECIMAL(12,2) NOT NULL,
    "from_branch_id" UUID,
    "to_room_id" UUID,
    "amortization_months" INTEGER,
    "date" DATE NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "room_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "stock_item_id" UUID NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "room_balances_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "stock_items_tenant_id_idx" ON "stock_items"("tenant_id");
CREATE INDEX "stock_balances_tenant_id_idx" ON "stock_balances"("tenant_id");
CREATE UNIQUE INDEX "stock_balances_stock_item_id_branch_id_key" ON "stock_balances"("stock_item_id", "branch_id");
CREATE INDEX "stock_movements_tenant_id_idx" ON "stock_movements"("tenant_id");
CREATE INDEX "stock_movements_stock_item_id_idx" ON "stock_movements"("stock_item_id");
CREATE INDEX "room_balances_tenant_id_idx" ON "room_balances"("tenant_id");
CREATE UNIQUE INDEX "room_balances_room_id_stock_item_id_key" ON "room_balances"("room_id", "stock_item_id");

-- Foreign keys
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_items"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_items"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "room_balances" ADD CONSTRAINT "room_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_balances" ADD CONSTRAINT "room_balances_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_balances" ADD CONSTRAINT "room_balances_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_items"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
