-- Enums for candidates
CREATE TYPE "EmployeeType" AS ENUM ('ACTIVE', 'CANDIDATE');
CREATE TYPE "CandidateStatus" AS ENUM ('NEW', 'INTERVIEW', 'TRIAL_DAY', 'HIRED', 'REJECTED');

-- Employee: candidate columns + can_view_own_salary
ALTER TABLE "employees" ADD COLUMN "type" "EmployeeType" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "employees" ADD COLUMN "candidate_status" "CandidateStatus";
ALTER TABLE "employees" ADD COLUMN "interview_history" JSONB;
ALTER TABLE "employees" ADD COLUMN "resume_url" TEXT;
ALTER TABLE "employees" ADD COLUMN "hire_date" DATE;
ALTER TABLE "employees" ADD COLUMN "fire_date" DATE;
ALTER TABLE "employees" ADD COLUMN "can_view_own_salary" BOOLEAN NOT NULL DEFAULT true;

-- Stock tables
CREATE TABLE "stock_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'шт',
    "min_quantity" DECIMAL(12,2) DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "type" TEXT NOT NULL,
    "comment" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "room_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "room_balances_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "stock_items_tenant_id_idx" ON "stock_items"("tenant_id");
CREATE INDEX "stock_balances_tenant_id_idx" ON "stock_balances"("tenant_id");
CREATE UNIQUE INDEX "stock_balances_item_id_branch_id_key" ON "stock_balances"("item_id", "branch_id");
CREATE INDEX "stock_movements_tenant_id_idx" ON "stock_movements"("tenant_id");
CREATE UNIQUE INDEX "room_balances_room_id_item_id_key" ON "room_balances"("room_id", "item_id");

-- Foreign keys
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "room_balances" ADD CONSTRAINT "room_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_balances" ADD CONSTRAINT "room_balances_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_balances" ADD CONSTRAINT "room_balances_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
