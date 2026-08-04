-- Скидки v3 (docs/discounts-v3.md): пер-абонементные шаблоны как ОПТ-ИН категория
-- рядом с клиентскими скидками v2 (не замена — в отличие от откаченной 20260804150000).
--
--   1) DiscountTemplateScope: область ручного шаблона (тип 2) — client | subscription.
--   2) discount_templates.scope — по умолчанию client (все существующие permanent,
--      системный тип-1 и легаси остаются client; признак у тип-1/легаси в UI скрыт).
--   3) clients.per_sub_discount_mode — режим «Шаблоны скидок на абонементы»
--      (эксклюзивно: тип 1 и клиентский тип 2 не действуют).
--   4) subscriptions.discount_template_id (+FK) — выбранный вручную для ЭТОГО
--      абонемента шаблон scope=subscription; переносится при выписке. Возвращаем
--      колонку, дропнутую откатом 20260804160000. Существующие данные не мигрируем.

-- CreateEnum
CREATE TYPE "DiscountTemplateScope" AS ENUM ('client', 'subscription');

-- AlterTable
ALTER TABLE "discount_templates" ADD COLUMN "scope" "DiscountTemplateScope" NOT NULL DEFAULT 'client';

-- AlterTable
ALTER TABLE "clients" ADD COLUMN "per_sub_discount_mode" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "discount_template_id" UUID;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_discount_template_id_fkey" FOREIGN KEY ("discount_template_id") REFERENCES "discount_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
