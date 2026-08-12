-- Одна строка обзвона = один подопечный. Раньше CallCampaignItem был по клиенту
-- (в списке показывался один произвольный подопечный). Теперь при создании
-- кампании генерируется строка на каждого подходящего подопечного; при фильтре
-- по дате рождения — только на попавших в диапазон.
--
-- Колонка nullable: NULL — у клиента нет подопечных ИЛИ это легаси-строка,
-- созданная до перехода (по клиенту). Легаси-строки не мигрируем: старые
-- кампании остаются как есть (карточка отображает подопечного по фоллбэку).

ALTER TABLE "call_campaign_items" ADD COLUMN "ward_id" UUID;

CREATE INDEX "call_campaign_items_ward_id_idx" ON "call_campaign_items"("ward_id");

ALTER TABLE "call_campaign_items"
  ADD CONSTRAINT "call_campaign_items_ward_id_fkey"
  FOREIGN KEY ("ward_id") REFERENCES "wards"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
