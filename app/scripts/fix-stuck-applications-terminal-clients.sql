-- Бэкфил 14.07.2026: вывод из воронки активных заявок клиентов в архиве/ЧС
-- (зависли до фикса dd6d1d7 — старый PATCH/импорт не закрывали заявки).
-- Зеркалит removeApplicationFromFunnel: отмена scheduled-пробных, soft-delete
-- заявки (status=processed), пересчёт wards.sales_stage, закрытие зависших
-- автозадач payment_due/trial_reminder. Pending-абонементы с деньгами НЕ
-- трогаем (кейс Скляр, Dream — ручное решение владельца: won/отчисление).
-- Ожидаемый охват на msk1: 4 заявки (3 тестовых «Умные дети», 1 Dream).

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE stuck_apps AS
SELECT a.id AS app_id, a.ward_id, a.client_id, a.tenant_id,
       a.stage AS old_stage, w.sales_stage AS old_ward_stage
FROM applications a
JOIN clients c ON c.id = a.client_id
JOIN wards w ON w.id = a.ward_id
WHERE a.status = 'active' AND a.deleted_at IS NULL
  AND (c.funnel_status IN ('archived', 'blacklisted') OR c.deleted_at IS NOT NULL);

-- Guard + референс для отката (старые значения).
SELECT * FROM stuck_apps;

-- 1. Отменить запланированные пробные этих заявок (ожидается 0).
UPDATE trial_lessons SET status = 'cancelled', updated_at = now()
WHERE application_id IN (SELECT app_id FROM stuck_apps) AND status = 'scheduled';

-- 2. Soft-delete заявок (как removeApplicationFromFunnel).
UPDATE applications SET deleted_at = now(), status = 'processed', updated_at = now()
WHERE id IN (SELECT app_id FROM stuck_apps);

-- 3. Пересчёт зеркала Ward.salesStage: максимальный этап оставшихся активных
-- заявок, иначе 'none' (порядок значений enum = порядок определения).
UPDATE wards w
SET sales_stage = COALESCE(
      (SELECT a2.stage FROM applications a2
       WHERE a2.ward_id = w.id AND a2.status = 'active' AND a2.deleted_at IS NULL
       ORDER BY a2.stage DESC LIMIT 1),
      'none'),
    updated_at = now()
WHERE w.id IN (SELECT ward_id FROM stuck_apps);

-- 4. Закрыть зависшие автозадачи (payment_due плодился ежедневно по
-- застрявшему salesStage=awaiting_payment у Скляр).
UPDATE tasks SET status = 'completed', completed_at = now()
WHERE client_id IN (SELECT client_id FROM stuck_apps)
  AND auto_trigger IN ('payment_due', 'trial_reminder')
  AND status = 'pending' AND deleted_at IS NULL;

-- Контроль после.
SELECT s.app_id, a.status, a.deleted_at IS NOT NULL AS deleted, w.sales_stage AS new_ward_stage
FROM stuck_apps s
JOIN applications a ON a.id = s.app_id
JOIN wards w ON w.id = s.ward_id;

COMMIT;
