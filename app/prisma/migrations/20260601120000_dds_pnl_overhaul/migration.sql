-- Фундамент модулей ДДС-журнала и ОПИУ с периодом признания.
-- Подробности — в плане: C:\Users\Cyberjinn\.claude\plans\gleaming-gathering-cloud.md
--
-- В этой миграции:
--   1. Справочник IncomeCategory (системные + tenant-кастомные).
--   2. Поле Payment.income_category_id для прочих доходов; client_id становится nullable.
--   3. Enum ExpenseRecognitionMode + Expense.recognition_mode (по умолчанию by_payment_date —
--      существующие расходы не меняют поведение в ОПИУ).
--   4. SalaryPaymentItem — построчные позиции выплат ЗП (счёт × направление × сумма).
--   5. Employee.monthly_salary + default_direction_id — для окладников.
--   6. Бэкфилл: системные IncomeCategory; SalaryPaymentItem для каждой существующей SalaryPayment.

-- === 1. IncomeCategory =====================================================
CREATE TABLE "income_categories" (
  "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"  UUID,
  "name"       TEXT         NOT NULL,
  "is_system"  BOOLEAN      NOT NULL DEFAULT false,
  "is_active"  BOOLEAN      NOT NULL DEFAULT true,
  "sort_order" INTEGER      NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "income_categories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "income_categories_tenant_id_idx" ON "income_categories"("tenant_id");

-- Системные категории доходов: tenant_id = NULL, видны всем тенантам.
INSERT INTO "income_categories" ("name", "is_system", "sort_order") VALUES
  ('Оплата абонементов', true, 0),
  ('Проценты банка',     true, 10),
  ('Продажа товаров',    true, 20),
  ('Прочее',             true, 30);

-- === 2. Payment.income_category_id + client_id nullable ====================
ALTER TABLE "payments"
  ADD COLUMN "income_category_id" UUID,
  ALTER COLUMN "client_id" DROP NOT NULL;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_income_category_id_fkey"
  FOREIGN KEY ("income_category_id") REFERENCES "income_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- === 3. Expense.recognition_mode ===========================================
CREATE TYPE "ExpenseRecognitionMode" AS ENUM ('by_payment_date', 'single_period', 'amortized');

ALTER TABLE "expenses"
  ADD COLUMN "recognition_mode" "ExpenseRecognitionMode" NOT NULL DEFAULT 'by_payment_date';

-- Существующие расходы с заполненными amortization_months/start_date — переводим в режим
-- amortized, чтобы поведение P&L после включения раскладки осталось согласованным.
UPDATE "expenses"
SET "recognition_mode" = 'amortized'::"ExpenseRecognitionMode"
WHERE "amortization_months" IS NOT NULL
  AND "amortization_months" > 1
  AND "amortization_start_date" IS NOT NULL;

-- === 4. SalaryPaymentItem ==================================================
CREATE TABLE "salary_payment_items" (
  "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"         UUID         NOT NULL,
  "salary_payment_id" UUID         NOT NULL,
  "employee_id"       UUID         NOT NULL,
  "account_id"        UUID         NOT NULL,
  "direction_id"      UUID,
  "amount"            DECIMAL(12,2) NOT NULL,
  "comment"           TEXT,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "salary_payment_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "salary_payment_items_tenant_employee_idx" ON "salary_payment_items"("tenant_id", "employee_id");
CREATE INDEX "salary_payment_items_salary_payment_id_idx" ON "salary_payment_items"("salary_payment_id");

ALTER TABLE "salary_payment_items"
  ADD CONSTRAINT "salary_payment_items_salary_payment_id_fkey"
  FOREIGN KEY ("salary_payment_id") REFERENCES "salary_payments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "salary_payment_items"
  ADD CONSTRAINT "salary_payment_items_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "salary_payment_items"
  ADD CONSTRAINT "salary_payment_items_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "salary_payment_items"
  ADD CONSTRAINT "salary_payment_items_direction_id_fkey"
  FOREIGN KEY ("direction_id") REFERENCES "directions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Бэкфилл: каждая существующая SalaryPayment превращается в одну SalaryPaymentItem.
-- direction_id = NULL (старые выплаты не были привязаны к направлению); новый код
-- учтёт это как «ЗП без направления» и распределит пропорционально выручке.
INSERT INTO "salary_payment_items" ("id", "tenant_id", "salary_payment_id", "employee_id", "account_id", "amount", "comment", "created_at")
SELECT
  gen_random_uuid(),
  sp."tenant_id",
  sp."id",
  sp."employee_id",
  sp."account_id",
  sp."amount",
  sp."comment",
  sp."created_at"
FROM "salary_payments" sp;

-- === 5. Employee.monthly_salary + default_direction_id =====================
ALTER TABLE "employees"
  ADD COLUMN "monthly_salary"        DECIMAL(12,2),
  ADD COLUMN "default_direction_id"  UUID;

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_default_direction_id_fkey"
  FOREIGN KEY ("default_direction_id") REFERENCES "directions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
