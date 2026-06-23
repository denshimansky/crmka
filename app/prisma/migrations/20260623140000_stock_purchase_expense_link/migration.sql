-- INV-01: закупка товара на склад создаёт расход (ДДС + ОПИУ). Связь движения
-- склада с расходом — для трассировки и возможного отката.
ALTER TABLE "stock_movements" ADD COLUMN "expense_id" UUID;

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_expense_id_fkey"
  FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "stock_movements_expense_id_idx" ON "stock_movements"("expense_id");
