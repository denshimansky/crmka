-- =============================================================================
-- ПОВТОРНОЕ ПЕРЕСОЗДАНИЕ ТЕСТОВОЙ ДЕМО-БАЗЫ (28.08.2026)
-- Ревизия скрипта от 03.08.2026: список skip-таблиц заменён префикс-паттерном
-- ^(_bak_|bak_|backup_|_fix_) — чтобы новые backup/снапшот-таблицы (их к 28.08
-- прибавилось 7 шт.) НЕ попадали в клон. Соль ремапа обновлена на 2026-08-28.
--
-- Что делает (ОДНА транзакция, при любой ошибке — полный откат):
--   1. Полностью очищает тенант «Детский центр „Умные дети“» (Соколова Т.,
--      0c7d15e7-...), КРОМЕ 6 демо-учёток (owner/manager/admin/admin2/
--      cyberj1nn/viewer) — чтобы сохранить доступы команды.
--   2. Клонирует ВСЕ данные тенанта «Детский центр Dream» (ac1849e2-...)
--      в тенант «Умные дети» с детерминированным ремапом всех UUID
--      (remap(u) = md5(u || соль)::uuid), включая «мягкие» ссылки без FK
--      (created_by, marked_by, entity_id и т.п. — любая uuid-колонка,
--      значение которой принадлежит вселенной ID Dream).
--      НЕ клонируются: page_views, login_attempts, audit_logs, ai_chat_logs
--      (логи с реальными IP/телефонами), client_portal_tokens (глобально
--      уникальные токены; у Dream их 0), integration_configs (секреты
--      платёжных интеграций; у Dream их 0).
--   3. Сотрудники Dream клонируются с: login || '.dm' (иначе вход реальных
--      сотрудников Dream сломается — auth глобально ищет по login и падает
--      на ambiguous_login), паролем-заглушкой (bcrypt случайного пароля —
--      вход невозможен), email/phone/resume_url/interview_history = NULL.
--   4. Копирует поведенческие настройки организации Dream (тип абонемента,
--      права ролей, сегментация и т.д.) на организацию «Умные дети»;
--      реквизиты/биллинг «Умных детей» не трогает.
--   5. Обезличивает телефоны клиентов: каждому клонированному клиенту с
--      телефоном — новый случайный уникальный '79XXXXXXXXX', не совпадающий
--      ни с одним телефоном в БД; phone2/social_link = NULL.
--   6. Guard-проверки перед COMMIT: точность счётчиков, FK-орфаны,
--      меж-тенантные ссылки, глобальная однозначность логинов '.dm',
--      непересечение телефонов. Любая проблема => EXCEPTION => ROLLBACK.
--
-- Требует superuser (session_replication_role = replica: обход FK-порядка
-- и отключение триггеров, напр. set_client_became_lead_at — значения
-- became_lead_at переносятся как есть).
-- Запуск:
--   ssh root@201.51.1.81 "docker exec -i crmka-db-1 psql -U crmka -d crmka \
--     -P pager=off -v ON_ERROR_STOP=1" < app/scripts/demo-reclone-dream-to-umnye-deti-20260828.sql
-- Затем: demo-anonymize-names-20260828.sql, demo-anonymize-extras-20260828.sql
-- Откат после COMMIT: восстановить из бэкапа pre-demo-reclone-20260828.dump
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL session_replication_role = replica;

CREATE FUNCTION pg_temp.remap(u uuid) RETURNS uuid
LANGUAGE sql IMMUTABLE AS
$fn$ SELECT md5(u::text || 'demo-clone-2026-08-28')::uuid $fn$;

DO $main$
DECLARE
  dream constant uuid := 'ac1849e2-daa5-45e2-91ea-774d643f1ba6'; -- Детский центр Dream
  sok   constant uuid := '0c7d15e7-d8e5-451c-b0ef-010f2f1b0476'; -- ДЦ «Умные дети» (тест)
  -- bcrypt случайного 96-символьного пароля: формат валиден, подобрать нельзя
  demo_pwd_hash constant text := '$2a$10$ajQx6UpNj1pHWic4NPcIUeDyPnlBu4OfvsH/H4Ob1/9xC.G0EAj7q';
  -- Только логи/токены/секреты (не клонируются, PII/секреты). Все backup/снапшот-
  -- таблицы (_bak_*, bak_*, backup_*, _fix_*) исключаются ПАТТЕРНОМ skip_rx ниже —
  -- это устойчиво к появлению новых снапшотов (в отличие от перечисления по имени).
  skip_tables constant text[] := ARRAY[
    'page_views','login_attempts','audit_logs','ai_chat_logs',
    'client_portal_tokens','integration_configs'];
  skip_rx constant text := '^(_bak_|bak_|backup_|_fix_)';
  kept_emps constant uuid[] := ARRAY[
    'e7c3559b-53e0-4f02-b1fe-1a0f48b7fb3c', -- owner   / Филатова Снежана
    'e4e27dd2-872c-4716-8d8d-f36a70fc6379', -- manager / Дроздов
    'b02f3861-b60d-4cdb-8c53-f66509f76edc', -- admin   / Савельева (admin.demo)
    '24adf840-5d3a-47a1-ae0a-c2eff82c894a', -- admin2  / Терентьева
    'aafbc538-503f-45d2-bd5c-c0e27dfd3085', -- cyberj1nn / Ковалёв
    '4f9eeebb-ffa2-4f60-a0b9-95f7bc7486ba'  -- viewer  / Лапин
  ]::uuid[];
  r record; c record;
  child_col text; parent_col text;
  cols text; exprs text; expr text;
  n bigint; expected bigint; bad bigint;
BEGIN
  ---------------------------------------------------------------------------
  -- 0. SANITY: правильные организации и предпосылки генератора
  ---------------------------------------------------------------------------
  PERFORM 1 FROM organizations WHERE id = dream AND name = 'Детский центр Dream';
  IF NOT FOUND THEN RAISE EXCEPTION 'org Dream не найдена по id+имени'; END IF;
  PERFORM 1 FROM organizations WHERE id = sok AND name LIKE '%Умные дети%';
  IF NOT FOUND THEN RAISE EXCEPTION 'тестовая org не найдена по id+имени'; END IF;

  SELECT count(*) INTO n FROM employees WHERE id = ANY(kept_emps) AND tenant_id = sok;
  IF n <> 6 THEN RAISE EXCEPTION 'ожидалось 6 сохраняемых сотрудников, найдено %', n; END IF;

  -- у всех клонируемых таблиц PK = id::uuid, нет колонок uuid[]
  FOR r IN SELECT DISTINCT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'tenant_id'
             AND table_name <> ALL(skip_tables) AND table_name !~ skip_rx LOOP
    PERFORM 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = r.table_name
       AND column_name = 'id' AND data_type = 'uuid';
    IF NOT FOUND THEN RAISE EXCEPTION 'таблица % без id::uuid', r.table_name; END IF;
    PERFORM 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = r.table_name
       AND data_type = 'ARRAY' AND udt_name = '_uuid';
    IF FOUND THEN RAISE EXCEPTION 'таблица % содержит uuid[] — генератор не поддерживает', r.table_name; END IF;
  END LOOP;

  -- из таблиц БЕЗ tenant_id на тенантные таблицы ссылается только users.employee_id
  FOR r IN
    SELECT child.relname AS child_tbl, parent.relname AS parent_tbl
    FROM pg_constraint con
    JOIN pg_class child  ON child.oid  = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    WHERE con.contype = 'f' AND ns.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns ic
                      WHERE ic.table_schema = 'public' AND ic.table_name = child.relname
                        AND ic.column_name = 'tenant_id')
      AND EXISTS (SELECT 1 FROM information_schema.columns ic
                  WHERE ic.table_schema = 'public' AND ic.table_name = parent.relname
                    AND ic.column_name = 'tenant_id')
      AND NOT (child.relname = 'users' AND parent.relname = 'employees')
  LOOP
    RAISE EXCEPTION 'неожиданный внешний FK вне тенанта: % -> %', r.child_tbl, r.parent_tbl;
  END LOOP;

  ---------------------------------------------------------------------------
  -- 1. Вселенная ID Dream + ожидаемые счётчики (до любых изменений)
  ---------------------------------------------------------------------------
  CREATE TEMP TABLE dream_ids(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE expect(tbl text PRIMARY KEY, cnt bigint) ON COMMIT DROP;
  FOR r IN SELECT DISTINCT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'tenant_id'
             AND table_name <> ALL(skip_tables) AND table_name !~ skip_rx LOOP
    EXECUTE format('INSERT INTO dream_ids SELECT id FROM %I WHERE tenant_id = %L ON CONFLICT DO NOTHING',
                   r.table_name, dream);
    EXECUTE format('INSERT INTO expect SELECT %L, count(*) FROM %I WHERE tenant_id = %L',
                   r.table_name, r.table_name, dream);
  END LOOP;
  SELECT count(*) INTO n FROM dream_ids;
  RAISE NOTICE 'вселенная ID Dream: % строк', n;

  ---------------------------------------------------------------------------
  -- 2. Полная очистка тестового тенанта (кроме kept_emps и их auth-записей)
  ---------------------------------------------------------------------------
  -- auth-записи (users/accounts/sessions) удаляемых сотрудников; каскады
  -- отключены replica-режимом — удаляем явно и в правильном порядке
  DELETE FROM sessions s USING users u, employees e
   WHERE s.user_id = u.id AND u.employee_id = e.id
     AND e.tenant_id = sok AND NOT (e.id = ANY(kept_emps));
  DELETE FROM accounts a USING users u, employees e
   WHERE a.user_id = u.id AND u.employee_id = e.id
     AND e.tenant_id = sok AND NOT (e.id = ANY(kept_emps));
  DELETE FROM users u USING employees e
   WHERE u.employee_id = e.id
     AND e.tenant_id = sok AND NOT (e.id = ANY(kept_emps));

  FOR r IN SELECT DISTINCT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'tenant_id' LOOP
    IF r.table_name = 'employees' THEN
      EXECUTE format('DELETE FROM employees WHERE tenant_id = %L AND NOT (id = ANY(%L::uuid[]))',
                     sok, kept_emps);
    ELSE
      EXECUTE format('DELETE FROM %I WHERE tenant_id = %L', r.table_name, sok);
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE 'очистка %: удалено %', r.table_name, n; END IF;
  END LOOP;

  ---------------------------------------------------------------------------
  -- 3. Клонирование Dream -> тест: каждая uuid-колонка ремапится, если её
  --    значение принадлежит вселенной ID Dream (система/NULL — как есть)
  ---------------------------------------------------------------------------
  FOR r IN SELECT DISTINCT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'tenant_id'
             AND table_name <> ALL(skip_tables) AND table_name !~ skip_rx
           ORDER BY table_name LOOP
    cols := ''; exprs := '';
    FOR c IN SELECT column_name, data_type FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = r.table_name
             ORDER BY ordinal_position LOOP
      IF c.column_name = 'tenant_id' THEN
        expr := format('%L::uuid', sok);
      ELSIF c.column_name = 'id' THEN
        expr := 'pg_temp.remap(id)';
      ELSIF r.table_name = 'employees' AND c.column_name = 'login' THEN
        expr := format('login || %L', '.dm');
      ELSIF r.table_name = 'employees' AND c.column_name = 'password_hash' THEN
        expr := quote_literal(demo_pwd_hash);
      ELSIF r.table_name = 'employees'
        AND c.column_name IN ('email','phone','resume_url','interview_history') THEN
        expr := 'NULL';
      ELSIF c.data_type = 'uuid' THEN
        expr := format('CASE WHEN %1$I IN (SELECT id FROM dream_ids) THEN pg_temp.remap(%1$I) ELSE %1$I END',
                       c.column_name);
      ELSE
        expr := quote_ident(c.column_name);
      END IF;
      cols  := cols  || CASE WHEN cols  = '' THEN '' ELSE ', ' END || quote_ident(c.column_name);
      exprs := exprs || CASE WHEN exprs = '' THEN '' ELSE ', ' END || expr;
    END LOOP;

    EXECUTE format('INSERT INTO %I (%s) SELECT %s FROM %I WHERE tenant_id = %L',
                   r.table_name, cols, exprs, r.table_name, dream);
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT cnt INTO expected FROM expect WHERE tbl = r.table_name;
    IF n <> expected THEN
      RAISE EXCEPTION 'клонирование %: вставлено %, ожидалось %', r.table_name, n, expected;
    END IF;
    IF n > 0 THEN RAISE NOTICE 'клонирование %: % строк', r.table_name, n; END IF;
  END LOOP;

  ---------------------------------------------------------------------------
  -- 4. Поведенческие настройки организации Dream -> тест (без реквизитов/биллинга)
  ---------------------------------------------------------------------------
  UPDATE organizations s SET
    salary_day_1 = d.salary_day_1,
    salary_day_2 = d.salary_day_2,
    pay_for_absence = d.pay_for_absence,
    trial_pay_mode = d.trial_pay_mode,
    attendance_deadline = d.attendance_deadline,
    debt_limit = d.debt_limit,
    makeup_days_limit = d.makeup_days_limit,
    makeup_deadline_days = d.makeup_deadline_days,
    role_display_names = d.role_display_names,
    role_permissions = d.role_permissions,
    onboarding_completed = d.onboarding_completed,
    subscription_type = d.subscription_type,
    subscription_type_locked_at = d.subscription_type_locked_at,
    package_default_valid_days = d.package_default_valid_days,
    package_expiry_notify_days_before = d.package_expiry_notify_days_before,
    unpaid_subscription_auto_close_days = d.unpaid_subscription_auto_close_days,
    hide_phones_from_instructors = d.hide_phones_from_instructors,
    restrict_client_export = d.restrict_client_export,
    task_trigger_settings = d.task_trigger_settings,
    segmentation_config = d.segmentation_config,
    updated_at = now()
  FROM organizations d
  WHERE s.id = sok AND d.id = dream;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'настройки организации: обновлено % строк вместо 1', n; END IF;

  ---------------------------------------------------------------------------
  -- 5. Сохранённые демо-учётки: привязка ко всем новым филиалам, чистка ссылок
  ---------------------------------------------------------------------------
  UPDATE employees SET default_direction_id = NULL
   WHERE id = ANY(kept_emps) AND default_direction_id IS NOT NULL;

  INSERT INTO employee_branches (id, tenant_id, employee_id, branch_id)
  SELECT gen_random_uuid(), sok, e.emp, b.id
  FROM unnest(kept_emps) AS e(emp)
  CROSS JOIN branches b
  WHERE b.tenant_id = sok AND b.deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'привязки демо-учёток к филиалам: %', n;

  ---------------------------------------------------------------------------
  -- 6. Обезличивание телефонов клиентов
  ---------------------------------------------------------------------------
  CREATE TEMP TABLE existing_phones ON COMMIT DROP AS
    SELECT DISTINCT regexp_replace(phone, '\D', '', 'g') AS p
      FROM clients WHERE phone IS NOT NULL
    UNION
    SELECT DISTINCT regexp_replace(phone2, '\D', '', 'g')
      FROM clients WHERE phone2 IS NOT NULL;

  CREATE TEMP TABLE tgt ON COMMIT DROP AS
    SELECT id, row_number() OVER (ORDER BY id) AS rn
      FROM clients
     WHERE tenant_id = sok AND phone IS NOT NULL AND phone <> '';

  CREATE TEMP TABLE pool ON COMMIT DROP AS
    SELECT num, row_number() OVER (ORDER BY random()) AS rn
      FROM (SELECT DISTINCT '79' || lpad(floor(random() * 1e9)::bigint::text, 9, '0') AS num
              FROM generate_series(1, 40000)) x
     WHERE num NOT IN (SELECT p FROM existing_phones)
       AND substr(num, 2) NOT IN (SELECT p FROM existing_phones)
       AND '8' || substr(num, 2) NOT IN (SELECT p FROM existing_phones);

  SELECT count(*) INTO expected FROM tgt;
  SELECT count(*) INTO n FROM pool;
  IF n < expected THEN RAISE EXCEPTION 'пул телефонов мал: % < %', n, expected; END IF;

  UPDATE clients cl SET phone = p.num
  FROM tgt t JOIN pool p USING (rn)
  WHERE cl.id = t.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> expected THEN RAISE EXCEPTION 'телефоны: обновлено % из %', n, expected; END IF;
  RAISE NOTICE 'телефоны обезличены: %', n;

  UPDATE clients SET phone2 = NULL
   WHERE tenant_id = sok AND phone2 IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'phone2 -> NULL: %', n;

  UPDATE clients SET social_link = NULL
   WHERE tenant_id = sok AND social_link IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'social_link -> NULL: %', n;

  ---------------------------------------------------------------------------
  -- 7. GUARD-ПРОВЕРКИ (любая ошибка => полный откат)
  ---------------------------------------------------------------------------
  -- 7.1 FK-целостность и меж-тенантные ссылки для всех строк тестового тенанта
  FOR r IN
    SELECT con.conname,
           child.relname  AS child_tbl,
           parent.relname AS parent_tbl,
           (SELECT attname FROM pg_attribute
             WHERE attrelid = con.conrelid AND attnum = con.conkey[1])  AS ccol,
           (SELECT attname FROM pg_attribute
             WHERE attrelid = con.confrelid AND attnum = con.confkey[1]) AS pcol,
           cardinality(con.conkey) AS ncols
    FROM pg_constraint con
    JOIN pg_class child  ON child.oid  = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    WHERE con.contype = 'f' AND ns.nspname = 'public'
      AND EXISTS (SELECT 1 FROM information_schema.columns ic
                  WHERE ic.table_schema = 'public' AND ic.table_name = child.relname
                    AND ic.column_name = 'tenant_id')
  LOOP
    IF r.ncols <> 1 THEN
      RAISE EXCEPTION 'композитный FK % на % — проверка не поддерживает', r.conname, r.child_tbl;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM %I ch
        WHERE ch.tenant_id = $1 AND ch.%I IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I p WHERE p.%I = ch.%I)',
      r.child_tbl, r.ccol, r.parent_tbl, r.pcol, r.ccol)
      USING sok INTO bad;
    IF bad > 0 THEN
      RAISE EXCEPTION 'FK-орфаны: %.% -> % (% строк)', r.child_tbl, r.ccol, r.parent_tbl, bad;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns ic
               WHERE ic.table_schema = 'public' AND ic.table_name = r.parent_tbl
                 AND ic.column_name = 'tenant_id') THEN
      EXECUTE format(
        'SELECT count(*) FROM %I ch JOIN %I p ON p.%I = ch.%I
          WHERE ch.tenant_id = $1 AND p.tenant_id IS NOT NULL AND p.tenant_id <> $1',
        r.child_tbl, r.parent_tbl, r.pcol, r.ccol)
        USING sok INTO bad;
      IF bad > 0 THEN
        RAISE EXCEPTION 'МЕЖ-ТЕНАНТНАЯ ссылка: %.% -> % (% строк)', r.child_tbl, r.ccol, r.parent_tbl, bad;
      END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'FK-целостность и изоляция тенанта: OK';

  -- 7.2 сверка счётчиков клона
  FOR r IN SELECT tbl, cnt FROM expect LOOP
    IF r.tbl = 'employees' THEN
      EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = %L', r.tbl, sok) INTO n;
      IF n <> r.cnt + 6 THEN RAISE EXCEPTION 'employees: % вместо %', n, r.cnt + 6; END IF;
    ELSIF r.tbl = 'employee_branches' THEN
      NULL; -- клон Dream + связки kept_emps, проверено выше по ROW_COUNT
    ELSE
      EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = %L', r.tbl, sok) INTO n;
      IF n <> r.cnt THEN RAISE EXCEPTION 'счётчик %: % вместо %', r.tbl, n, r.cnt; END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'счётчики клона: OK';

  -- 7.3 логины '.dm' не должны существовать ни в одном другом тенанте
  SELECT count(*) INTO bad
  FROM employees s
  JOIN employees o ON o.login = s.login AND o.tenant_id <> s.tenant_id
  WHERE s.tenant_id = sok AND s.login LIKE '%.dm';
  IF bad > 0 THEN RAISE EXCEPTION 'коллизия логинов .dm с другими тенантами: %', bad; END IF;

  -- 7.4 у клонированных сотрудников нет email и нет исходных паролей
  SELECT count(*) INTO bad FROM employees
   WHERE tenant_id = sok AND login LIKE '%.dm'
     AND (email IS NOT NULL OR phone IS NOT NULL OR password_hash <> demo_pwd_hash);
  IF bad > 0 THEN RAISE EXCEPTION 'сотрудники .dm с непустым email/phone/чужим паролем: %', bad; END IF;

  -- 7.5 телефоны: нет пересечений с другими тенантами, нет дублей внутри теста
  SELECT count(*) INTO bad
  FROM clients s JOIN clients o
    ON o.phone = s.phone AND o.tenant_id <> s.tenant_id
  WHERE s.tenant_id = sok AND s.phone IS NOT NULL AND s.phone <> '';
  IF bad > 0 THEN RAISE EXCEPTION 'телефоны совпадают с другими тенантами: %', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT phone FROM clients
     WHERE tenant_id = sok AND phone IS NOT NULL
     GROUP BY phone HAVING count(*) > 1) q;
  IF bad > 0 THEN RAISE EXCEPTION 'дубли телефонов внутри теста: %', bad; END IF;

  -- 7.6 ни один клонированный id не совпадает с исходным id Dream
  SELECT count(*) INTO bad FROM clients WHERE tenant_id = sok AND id IN (SELECT id FROM dream_ids);
  IF bad > 0 THEN RAISE EXCEPTION 'clients: % строк с не-ремапнутым id', bad; END IF;
  SELECT count(*) INTO bad FROM subscriptions WHERE tenant_id = sok AND id IN (SELECT id FROM dream_ids);
  IF bad > 0 THEN RAISE EXCEPTION 'subscriptions: % строк с не-ремапнутым id', bad; END IF;

  RAISE NOTICE 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ';
END
$main$;

COMMIT;

-- Краткая сводка после фиксации
SELECT o.name,
  (SELECT count(*) FROM clients c WHERE c.tenant_id = o.id)       AS clients,
  (SELECT count(*) FROM employees e WHERE e.tenant_id = o.id)     AS employees,
  (SELECT count(*) FROM branches b WHERE b.tenant_id = o.id)      AS branches,
  (SELECT count(*) FROM subscriptions s WHERE s.tenant_id = o.id) AS subs,
  (SELECT count(*) FROM lessons l WHERE l.tenant_id = o.id)       AS lessons
FROM organizations o
WHERE o.id IN ('ac1849e2-daa5-45e2-91ea-774d643f1ba6', '0c7d15e7-d8e5-451c-b0ef-010f2f1b0476');
