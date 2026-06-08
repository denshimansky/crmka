-- Конфиг сегментации клиентов на организацию.
-- Форма: { mode: "amount"|"months", thresholds: { standard, regular, vip } }.
-- Если NULL — у всех клиентов сегмент «Новый».

ALTER TABLE "organizations" ADD COLUMN "segmentation_config" JSONB;
