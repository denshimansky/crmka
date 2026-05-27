-- Ф6: Безопасность данных и настройки автотриггеров задач.
-- Все три поля опциональные/со значением по умолчанию — миграция безопасная.

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "hide_phones_from_instructors" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "restrict_client_export" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "task_trigger_settings" JSONB;
