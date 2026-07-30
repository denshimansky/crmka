-- Пер-пакетные переопределения цены занятия направления (тип "package"):
-- JSON { packageTemplateId: ценаЗанятия }; отсутствие ключа → базовая lesson_price
-- (см. app/src/lib/subscriptions/package-price.ts). Аддитивно, nullable.
ALTER TABLE "directions" ADD COLUMN "package_prices" JSONB;

-- Выбранный в заявке пакет. Долетает до абонемента при конвертации «Ожидаем оплату».
-- onDelete: SetNull — удаление шаблона пакета не рушит заявку.
ALTER TABLE "applications" ADD COLUMN "package_template_id" UUID;

ALTER TABLE "applications"
  ADD CONSTRAINT "applications_package_template_id_fkey"
  FOREIGN KEY ("package_template_id") REFERENCES "package_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
