-- Ф2.0: расширение баланс-ledger'а и Direction для разовых посещений

-- Расширение enum BalanceTransactionType
ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'subscription_issued';
ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'subscription_closed_refund';
ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'lesson_refund';
ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'personal_lesson_charge';
ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'attendance_revert';

-- ClientBalanceTransaction: новые поля для трассировки источника
ALTER TABLE "client_balance_transactions"
  ADD COLUMN "balance_after" DECIMAL(12, 2),
  ADD COLUMN "lesson_id" UUID,
  ADD COLUMN "direction_id" UUID,
  ADD COLUMN "attendance_id" UUID;

ALTER TABLE "client_balance_transactions"
  ADD CONSTRAINT "client_balance_transactions_lesson_id_fkey"
    FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "client_balance_transactions_direction_id_fkey"
    FOREIGN KEY ("direction_id") REFERENCES "directions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "client_balance_transactions_attendance_id_fkey"
    FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "client_balance_transactions_tenant_id_subscription_id_idx"
  ON "client_balance_transactions"("tenant_id", "subscription_id");

-- Direction: цена разового посещения (для кнопки «Добавить ученика» без абонемента)
ALTER TABLE "directions"
  ADD COLUMN "single_visit_price" DECIMAL(12, 2);
