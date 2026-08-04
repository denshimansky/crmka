-- Скидки v3 (пер-абонементные): выбранный ВРУЧНУЮ для конкретного абонемента
-- шаблон скидки (тип 2, permanent). NULL — ручная скидка не выбрана. Заменяет
-- client.discount_template_id, который красил скидку на ВСЕ абонементы клиента:
-- теперь скидка применяется только там, где выбрана в форме абонемента, и
-- переносится при массовой/точечной выписке (previous_subscription).
-- Существующие данные не мигрируем: уже выданные скидки доживают как есть.

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "discount_template_id" UUID;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_discount_template_id_fkey" FOREIGN KEY ("discount_template_id") REFERENCES "discount_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
