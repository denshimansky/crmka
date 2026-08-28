-- =============================================================================
-- ДОП. ОБЕЗЛИЧИВАНИЕ ДЕМО-БАЗЫ «Умные дети» (28.08.2026)
-- Запускать ПОСЛЕ demo-reclone-...-20260828.sql и demo-anonymize-names-20260828.sql.
--
-- Ревизия скрипта от 03.08.2026: вместо жёсткого перечня полей — data-driven чистка
-- ВСЕХ свободнотекстовых колонок (comment|note|content|description|message|reason|
-- remark|memo) во всех клонируемых тенантных таблицах. Устойчиво к дрейфу схемы:
-- новые PII-поля (напр. communications.content — 2635 строк, clients.blacklist_reason,
-- lessons.cancel_reason, subscriptions.scheduled_withdrawal_comment) чистятся сами.
--
-- Что делает (одна транзакция, при ошибке — полный откат):
--   1. Филиалы: имена -> «Филиал N», адреса и контакты -> NULL.
--   2. Задачи и уведомления тенанта -> удалить (в заголовках/тексте ФИО клиентов;
--      крон пересоздаст автозадачи с новыми, уже обезличенными именами).
--   3. Все свободнотекстовые колонки клонированных таблиц -> NULL (или '' для NOT NULL).
--   4. Точечно: clients.email -> NULL, communications.metadata/external_id -> NULL
--      (не ловятся паттерном по имени, но могут нести PII).
--   Только тенант sok. Логи/секреты и backup-таблицы не трогаются.
-- Guard: пост-проверка, что ни в одной свободнотекстовой колонке sok не осталось данных.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

DO $main$
DECLARE
  sok constant uuid := '0c7d15e7-d8e5-451c-b0ef-010f2f1b0476'; -- ДЦ «Умные дети» (тест)
  -- те же исключения, что в скрипте клонирования: логи/токены/секреты + backup-паттерн
  skip_tables constant text[] := ARRAY[
    'page_views','login_attempts','audit_logs','ai_chat_logs',
    'client_portal_tokens','integration_configs'];
  skip_rx constant text := '^(_bak_|bak_|backup_|_fix_)';
  freetext_rx constant text := '(comment|note|content|description|message|reason|remark|memo)';
  r record; n bigint; bad bigint;
BEGIN
  PERFORM 1 FROM organizations WHERE id = sok AND name LIKE '%Умные дети%';
  IF NOT FOUND THEN RAISE EXCEPTION 'тестовая org не найдена по id+имени'; END IF;

  ---------------------------------------------------------------------------
  -- 1. Филиалы: обезличенные имена + обнуление адресов/контактов
  ---------------------------------------------------------------------------
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

  ---------------------------------------------------------------------------
  -- 2. Удалить задачи и уведомления (заголовки/текст содержат ФИО клиентов)
  ---------------------------------------------------------------------------
  DELETE FROM tasks WHERE tenant_id = sok;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'задачи удалены: %', n;
  DELETE FROM notifications WHERE tenant_id = sok;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'уведомления удалены: %', n;

  ---------------------------------------------------------------------------
  -- 3. Data-driven чистка всех свободнотекстовых колонок клонированных таблиц
  ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.table_name, c.column_name, c.is_nullable
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.data_type IN ('text','character varying')
      AND c.column_name ~* freetext_rx
      AND c.table_name IN (SELECT DISTINCT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'tenant_id')
      AND c.table_name <> ALL(skip_tables)
      AND c.table_name !~ skip_rx
      AND c.table_name NOT IN ('tasks','notifications')  -- уже удалены целиком
    ORDER BY c.table_name, c.column_name
  LOOP
    IF r.is_nullable = 'YES' THEN
      EXECUTE format('UPDATE %I SET %I = NULL WHERE tenant_id = %L AND %I IS NOT NULL',
                     r.table_name, r.column_name, sok, r.column_name);
    ELSE
      EXECUTE format('UPDATE %I SET %I = %L WHERE tenant_id = %L AND %I <> %L',
                     r.table_name, r.column_name, ''::text, sok, r.column_name, ''::text);
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE 'чистка %.%: %', r.table_name, r.column_name, n; END IF;
  END LOOP;

  ---------------------------------------------------------------------------
  -- 4. Точечные PII-поля, не ловящиеся паттерном по имени
  ---------------------------------------------------------------------------
  UPDATE clients SET email = NULL WHERE tenant_id = sok AND email IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'clients.email -> NULL: %', n;
  UPDATE communications SET metadata = NULL WHERE tenant_id = sok AND metadata IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'communications.metadata -> NULL: %', n;
  UPDATE communications SET external_id = NULL WHERE tenant_id = sok AND external_id IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'communications.external_id -> NULL: %', n;

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
  SELECT count(*) INTO bad FROM notifications WHERE tenant_id = sok;
  IF bad > 0 THEN RAISE EXCEPTION 'остались уведомления: %', bad; END IF;

  SELECT count(*) INTO bad FROM clients WHERE tenant_id = sok AND email IS NOT NULL;
  IF bad > 0 THEN RAISE EXCEPTION 'остались email у клиентов: %', bad; END IF;

  -- полнота: ни в одной свободнотекстовой колонке sok не должно остаться данных
  FOR r IN
    SELECT c.table_name, c.column_name, c.is_nullable
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.data_type IN ('text','character varying')
      AND c.column_name ~* freetext_rx
      AND c.table_name IN (SELECT DISTINCT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'tenant_id')
      AND c.table_name <> ALL(skip_tables)
      AND c.table_name !~ skip_rx
      AND c.table_name NOT IN ('tasks','notifications')
  LOOP
    IF r.is_nullable = 'YES' THEN
      EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = %L AND %I IS NOT NULL',
                     r.table_name, sok, r.column_name) INTO bad;
    ELSE
      EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = %L AND %I <> %L',
                     r.table_name, sok, r.column_name, ''::text) INTO bad;
    END IF;
    IF bad > 0 THEN RAISE EXCEPTION 'осталась PII в %.%: % строк', r.table_name, r.column_name, bad; END IF;
  END LOOP;

  RAISE NOTICE 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ';
END
$main$;

COMMIT;

SELECT b.name, b.address FROM branches b
WHERE b.tenant_id = '0c7d15e7-d8e5-451c-b0ef-010f2f1b0476' AND b.deleted_at IS NULL ORDER BY b.name;
