-- Откат Скидок v3 (пер-абонементные скидки) обратно к v2.
-- Миграции 20260804150000 (колонка subscriptions.discount_template_id) и
-- 20260804151000 (переименование системного шаблона) уже применены на прод/dev —
-- удалять их файлы нельзя (нарушится история). Эта миграция отменяет их эффект
-- forward-only:
--   1) имя системного шаблона обратно «Скидка за второй абонемент»;
--   2) колонка discount_template_id удаляется (на момент отката ни одного
--      абонемента с ней нет — проверено на msk1 и dev, 0 строк).
UPDATE "discount_templates"
SET "name" = 'Скидка за второй абонемент'
WHERE "system_key" = 'second_subscription';

ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "discount_template_id";
