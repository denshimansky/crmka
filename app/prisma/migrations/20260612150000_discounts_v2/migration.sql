-- Скидки v2 (docs/discounts-v2.md): новые enum-значения и колонки.
-- Данные мигрируются следующим файлом (новые enum-значения нельзя
-- использовать в той же транзакции, где они добавлены).

ALTER TYPE "DiscountType" ADD VALUE IF NOT EXISTS 'second_subscription';
ALTER TYPE "DiscountKind" ADD VALUE IF NOT EXISTS 'second_subscription';
ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'discount_refund';

-- Источник текущей скидки абонемента.
CREATE TYPE "SubscriptionDiscountSource" AS ENUM ('none', 'type1', 'type2', 'legacy');

ALTER TABLE "subscriptions"
  ADD COLUMN "discount_per_lesson" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "discount_source" "SubscriptionDiscountSource" NOT NULL DEFAULT 'none';

ALTER TABLE "discount_templates"
  ADD COLUMN "activated_at" TIMESTAMP(3),
  ADD COLUMN "is_legacy" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "discounts"
  ADD COLUMN "per_lesson_value" DECIMAL(12,2),
  ADD COLUMN "lessons_remaining" INTEGER;
