-- Атрибуция воронки к обзвону: заявка, созданная кнопкой «Создать заявку» в
-- кампании обзвона, ссылается на позицию обзвона. Отчёт «Эффективность обзвонов»
-- по этой связи считает пробные и продажи, выросшие из заявки.

ALTER TABLE "applications" ADD COLUMN "call_campaign_item_id" UUID;

CREATE INDEX "applications_call_campaign_item_id_idx" ON "applications"("call_campaign_item_id");

ALTER TABLE "applications"
  ADD CONSTRAINT "applications_call_campaign_item_id_fkey"
  FOREIGN KEY ("call_campaign_item_id") REFERENCES "call_campaign_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
