-- =============================================================================
-- ДОП. ОБЕЗЛИЧИВАНИЕ ДЕМО-БАЗЫ «Умные дети» (03.08.2026)
-- Запускать ПОСЛЕ clone.sql и names.sql.
--   1. Филиалы: имена -> «Филиал N», адреса и контакты -> NULL.
--   2. Задачи: удалить все (крон пересоздаст автозадачи с новыми именами);
--      заголовки автозадач содержали реальные ФИО клиентов.
--   3. Свободные текстовые поля с возможным PII клиентов/семей -> NULL.
--   4. Уведомления тенанта -> удалить (могут содержать ФИО клиентов).
-- Только тенант sok. Одна транзакция, при ошибке — полный откат.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

DO $main$
DECLARE
  sok constant uuid := '0c7d15e7-d8e5-451c-b0ef-010f2f1b0476'; -- ДЦ «Умные дети» (тест)
  n bigint; bad bigint;
BEGIN
  PERFORM 1 FROM organizations WHERE id = sok AND name LIKE '%Умные дети%';
  IF NOT FOUND THEN RAISE EXCEPTION 'тестовая org не найдена по id+имени'; END IF;

  -- 1. Филиалы: обезличенные имена + обнуление адресов/контактов
  WITH ordered AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
      FROM branches WHERE tenant_id = sok
  )
  UPDATE branches b SET
    name = 'Филиал ' || o.rn,
    address = NULL, contact_phone = NULL, contact_telegram = NULL, contact_whatsapp = NULL,
    updated_at = now()
  FROM ordered o WHERE b.id = o.id AND b.tenant_id = sok;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'филиалы обезличены: %', n;

  -- 2. Удалить все задачи (крон пересоздаст автозадачи из клонированных данных)
  DELETE FROM tasks WHERE tenant_id = sok;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'задачи удалены: %', n;

  -- 3. Уведомления тенанта (заголовок/текст могут содержать ФИО клиентов)
  DELETE FROM notifications WHERE tenant_id = sok;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'уведомления удалены: %', n;

  -- 4. Свободные текстовые поля с возможным PII -> NULL (только заполненные)
  UPDATE clients SET comment = NULL WHERE tenant_id = sok AND comment IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'clients.comment: %', n;
  UPDATE clients SET email = NULL WHERE tenant_id = sok AND email IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'clients.email: %', n;
  UPDATE wards SET notes = NULL WHERE tenant_id = sok AND notes IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'wards.notes: %', n;
  UPDATE applications SET comment = NULL WHERE tenant_id = sok AND comment IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'applications.comment: %', n;
  UPDATE trial_lessons SET comment = NULL WHERE tenant_id = sok AND comment IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'trial_lessons.comment: %', n;
  -- lesson_student_notes.comment — NOT NULL, поэтому пустая строка вместо NULL
  UPDATE lesson_student_notes SET comment = '' WHERE tenant_id = sok AND comment <> '';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'lesson_student_notes.comment: %', n;
  UPDATE bonus_discounts SET comment = NULL WHERE tenant_id = sok AND comment IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'bonus_discounts.comment: %', n;
  UPDATE discounts SET comment = NULL WHERE tenant_id = sok AND comment IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'discounts.comment: %', n;
  UPDATE client_balance_transactions SET comment = NULL WHERE tenant_id = sok AND comment IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'client_balance_transactions.comment: %', n;
  UPDATE payments SET comment = NULL WHERE tenant_id = sok AND comment IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'payments.comment: %', n;
  UPDATE account_operations SET description = NULL WHERE tenant_id = sok AND description IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'account_operations.description: %', n;
  UPDATE call_campaign_items SET comment = NULL WHERE tenant_id = sok AND comment IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'call_campaign_items.comment: %', n;
  UPDATE unprolonged_comments SET comment = '' WHERE tenant_id = sok AND comment <> '';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'unprolonged_comments.comment: %', n;
  UPDATE expenses SET comment = NULL WHERE tenant_id = sok AND comment IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'expenses.comment: %', n;
  UPDATE salary_adjustments SET comment = '' WHERE tenant_id = sok AND comment <> '';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'salary_adjustments.comment: %', n;
  UPDATE salary_payment_items SET comment = NULL WHERE tenant_id = sok AND comment IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'salary_payment_items.comment: %', n;
  UPDATE salary_payments SET comment = NULL WHERE tenant_id = sok AND comment IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'salary_payments.comment: %', n;

  ---------------------------------------------------------------------------
  -- GUARD-проверки
  ---------------------------------------------------------------------------
  SELECT count(*) INTO bad FROM branches WHERE tenant_id = sok
    AND (address IS NOT NULL OR contact_phone IS NOT NULL
      OR contact_telegram IS NOT NULL OR contact_whatsapp IS NOT NULL
      OR name !~ '^Филиал [0-9]+$');
  IF bad > 0 THEN RAISE EXCEPTION 'остались необезличенные филиалы: %', bad; END IF;

  SELECT count(*) INTO bad FROM tasks WHERE tenant_id = sok;
  IF bad > 0 THEN RAISE EXCEPTION 'остались задачи: %', bad; END IF;

  SELECT count(*) INTO bad FROM clients WHERE tenant_id = sok AND (comment IS NOT NULL OR email IS NOT NULL);
  IF bad > 0 THEN RAISE EXCEPTION 'остались comment/email у клиентов: %', bad; END IF;

  RAISE NOTICE 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ';
END
$main$;

COMMIT;

SELECT b.name, b.address FROM branches b
WHERE b.tenant_id = '0c7d15e7-d8e5-451c-b0ef-010f2f1b0476' AND b.deleted_at IS NULL ORDER BY b.name;
