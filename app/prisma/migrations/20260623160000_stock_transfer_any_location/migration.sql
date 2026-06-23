-- Перемещение товара в любом направлении: склад↔кабинет, склад↔склад, кабинет↔кабинет.
-- Раньше движение умело только склад→кабинет (from_branch_id → to_room_id).
-- Добавляем общий тип transfer и недостающие плечи: источник-кабинет + приёмник-склад.

ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'transfer';

ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "from_room_id" UUID,
  ADD COLUMN IF NOT EXISTS "to_branch_id" UUID;
