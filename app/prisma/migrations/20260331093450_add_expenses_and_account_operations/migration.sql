-- CreateEnum
CREATE TYPE "AccountOperationType" AS ENUM ('owner_withdrawal', 'encashment', 'transfer');

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "name" TEXT NOT NULL,
    "is_salary" BOOLEAN NOT NULL DEFAULT false,
    "is_variable" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "comment" TEXT,
    "amortization_months" INTEGER,
    "amortization_start_date" DATE,
    "is_variable" BOOLEAN NOT NULL DEFAULT false,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "recurring_group_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "branch_id" UUID,
    "direction_id" UUID,

    CONSTRAINT "expense_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_operations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "AccountOperationType" NOT NULL,
    "from_account_id" UUID,
    "to_account_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "account_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_categories_tenant_id_idx" ON "expense_categories"("tenant_id");

-- CreateIndex
CREATE INDEX "expenses_tenant_id_date_idx" ON "expenses"("tenant_id", "date");

-- CreateIndex
CREATE INDEX "expenses_tenant_id_category_id_idx" ON "expenses"("tenant_id", "category_id");

-- CreateIndex
CREATE INDEX "expense_branches_expense_id_idx" ON "expense_branches"("expense_id");

-- CreateIndex
CREATE INDEX "account_operations_tenant_id_date_idx" ON "account_operations"("tenant_id", "date");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_branches" ADD CONSTRAINT "expense_branches_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_branches" ADD CONSTRAINT "expense_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_branches" ADD CONSTRAINT "expense_branches_direction_id_fkey" FOREIGN KEY ("direction_id") REFERENCES "directions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: 14 системных категорий расходов
INSERT INTO "expense_categories" ("id", "name", "is_salary", "is_variable", "is_system", "is_active", "sort_order", "created_at")
VALUES
  (gen_random_uuid(), 'Аренда', false, false, true, true, 1, NOW()),
  (gen_random_uuid(), 'Коммунальные услуги', false, false, true, true, 2, NOW()),
  (gen_random_uuid(), 'Зарплата инструкторов', true, true, true, true, 3, NOW()),
  (gen_random_uuid(), 'Зарплата администраторов', true, false, true, true, 4, NOW()),
  (gen_random_uuid(), 'Зарплата управляющего', true, false, true, true, 5, NOW()),
  (gen_random_uuid(), 'Маркетинг и реклама', false, false, true, true, 6, NOW()),
  (gen_random_uuid(), 'Канцтовары и расходники', false, true, true, true, 7, NOW()),
  (gen_random_uuid(), 'Оборудование', false, false, true, true, 8, NOW()),
  (gen_random_uuid(), 'Связь и интернет', false, false, true, true, 9, NOW()),
  (gen_random_uuid(), 'Бухгалтерия', false, false, true, true, 10, NOW()),
  (gen_random_uuid(), 'Налоги и взносы', false, false, true, true, 11, NOW()),
  (gen_random_uuid(), 'Хозяйственные расходы', false, false, true, true, 12, NOW()),
  (gen_random_uuid(), 'Обучение персонала', false, false, true, true, 13, NOW()),
  (gen_random_uuid(), 'Прочие расходы', false, false, true, true, 14, NOW());
