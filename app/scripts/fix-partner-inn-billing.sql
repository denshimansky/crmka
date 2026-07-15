-- Заполнение ИНН партнёров + подготовка к автобиллингу (15.07.2026).
-- ✅ ПРИМЕНЁН на msk1 15.07.2026 (бэкапы: backup_orgs_inn_20260715,
-- backup_invoices_status_20260715). Повторный запуск безопасен (guard-условия),
-- но не нужен. Потребовал снятия уникального индекса organizations_inn_unique
-- (миграция 20260715150000_drop_org_inn_unique) — у Премеленной две
-- организации на один ИНН.
-- Список ИНН подтверждён владельцем (сверка от 15.07.2026, все контрольные
-- суммы валидны). Применять на msk1 ПОСЛЕ деплоя миграции
-- 20260715120000_saas_billing_automation (нужна колонка billing_exempt).
--
-- Открытые вопросы (НЕ в этом скрипте):
--  * Ряжко 501812544225 — организации на проде нет, ждём уточнения;
--  * legal_name (юрлицо «ИП Фамилия И.О.») — заполнить через админку,
--    пока в PDF счёта подставляется название организации.

BEGIN;

-- 1. ИНН по владельцам организаций
UPDATE organizations SET inn = '502706924675' WHERE name = 'ДЦ Игровая Академия' AND (inn IS NULL OR inn = '');
UPDATE organizations SET inn = '772070374529' WHERE name = 'ДЦ Сёма'            AND (inn IS NULL OR inn = '');
UPDATE organizations SET inn = '301710643630' WHERE name = 'ДЦ Скоро в школу'   AND (inn IS NULL OR inn = '');
UPDATE organizations SET inn = '300701361170' WHERE name = 'Детский центр Dream' AND (inn IS NULL OR inn = '');
UPDATE organizations SET inn = '504711350571' WHERE name = 'Школа студия Class' AND (inn IS NULL OR inn = '');
UPDATE organizations SET inn = '230216405075' WHERE name = 'ДЦ Знамникус'       AND (inn IS NULL OR inn = '');
-- Премеленная: две организации на один ИНН (решение: два отдельных счёта)
UPDATE organizations SET inn = '900400092547' WHERE name IN ('ДЦ Замок', 'ДЮЦ Чарівний замок') AND (inn IS NULL OR inn = '');
-- ДЦ Easy: на проде стоял фейк 7707083893 (ИНН Сбербанка) — заменяем
UPDATE organizations SET inn = '450126777542' WHERE name = 'ДЦ Easy' AND inn = '7707083893';

-- 2. Исключения из автобиллинга: своя организация Анны + тестовая
UPDATE organizations SET billing_exempt = true
WHERE name IN ('ДЦ Умный Я', 'Детский центр «Умные дети»');

-- 3. Старые сид-счета (INV-2026-*): отменяем незакрытый, чтобы первый прогон
-- блокировки 1-го числа не сработал по прошлогодней демо-задолженности
UPDATE billing_invoices SET status = 'cancelled',
  comment = COALESCE(comment || ' | ', '') || 'Отменён 15.07.2026: демо-счёт до запуска автобиллинга'
WHERE status = 'pending' AND number LIKE 'INV-%';

-- Контроль перед COMMIT: у 14 организаций ИНН, 2 exempt, 0 pending INV-*
SELECT name, inn, billing_exempt, billing_status FROM organizations ORDER BY name;
SELECT number, status FROM billing_invoices ORDER BY created_at;

COMMIT;
-- Откат при неожиданном результате контрольных SELECT: заменить COMMIT на ROLLBACK.
