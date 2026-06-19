-- Ручное переопределение сегмента клиента (баг #26).
-- NULL — сегмент берётся из авто-расчёта (Organization.segmentationConfig).
-- Не-NULL — владелец задал сегмент вручную (после импорта все «Новый»).
-- Эффективный сегмент = segment_override ?? авто.

ALTER TABLE "clients" ADD COLUMN "segment_override" "ClientSegment";
