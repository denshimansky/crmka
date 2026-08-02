-- Оклад как настоящий расход (твин). Выплата оклада создаёт SalaryPayment (ДДС/касса)
-- + связанный Expense с account_id=NULL (только ОПИУ). Здесь: FK expenses.salary_payment_id
-- (ON DELETE CASCADE — аннулирование выплаты убирает твин) + индекс, и идемпотентный сид
-- системной категории «Зарплата окладников» (tenant_id=NULL, is_salary, постоянный расход).

ALTER TABLE "expenses" ADD COLUMN "salary_payment_id" UUID;

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_salary_payment_id_fkey"
  FOREIGN KEY ("salary_payment_id") REFERENCES "salary_payments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "expenses_salary_payment_id_idx" ON "expenses" ("salary_payment_id");

-- Идемпотентный сид системной категории оклад-расхода.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM expense_categories WHERE name = 'Зарплата окладников' AND tenant_id IS NULL
  ) THEN
    INSERT INTO expense_categories (id, name, is_salary, is_variable, is_system, is_active, sort_order, created_at)
    VALUES (gen_random_uuid(), 'Зарплата окладников', true, false, true, true, 14, NOW());
  END IF;
END $$;
