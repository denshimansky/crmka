-- Валюта расчёта организации: только отображение символа/формата, без пересчёта
-- сумм по курсу. Текущие организации остаются на рубле и помечаются как
-- «выбор сделан» (currency_chosen=true), чтобы им не показывался запрос валюты
-- на дашборде; новым организациям currency_chosen остаётся false.
ALTER TABLE "organizations" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'RUB';
ALTER TABLE "organizations" ADD COLUMN "currency_chosen" BOOLEAN NOT NULL DEFAULT false;
UPDATE "organizations" SET "currency_chosen" = true;
