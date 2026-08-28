-- =============================================================================
-- ОБЕЗЛИЧИВАНИЕ ФИО В ДЕМО-БАЗЕ «Детский центр „Умные дети“» (28.08.2026)
-- Продолжение app/scripts/demo-reclone-dream-to-umnye-deti-20260828.sql.
--
-- Что делает (одна транзакция, при ошибке — полный откат):
--   1. Клиенты (родители): случайные ФИО. Пол 80% ж / 20% м; имя, отчество и
--      окончание фамилии согласованы по полу. NULL-поля остаются NULL
--      (сохраняем «рисунок заполненности» реальной базы).
--   2. Подопечные (дети): случайное имя (пол 50/50), фамилия = семейная
--      фамилия родителя (та же, что назначена клиенту), с окончанием по полу.
--   3. Клонированные сотрудники Dream (login LIKE '%.dm'): случайные ФИО
--      (пол 80% ж). 6 сохранённых демо-учёток не трогаем.
--   Только тенант sok. Dream и другие тенанты не затрагиваются ни одной
--   операцией (все UPDATE идут через временные таблицы, построенные с
--   фильтром tenant_id = sok).
--
-- Guard'ы: точное число обновлённых строк; случайные полные совпадения с
-- оригиналом Dream (сверка через ту же соль ремапа) в допустимых пределах.
-- Запуск:
--   ssh root@201.51.1.81 "docker exec -i crmka-db-1 psql -U crmka -d crmka \
--     -P pager=off -v ON_ERROR_STOP=1" < app/scripts/demo-anonymize-names.sql
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $main$
DECLARE
  sok   constant uuid := '0c7d15e7-d8e5-451c-b0ef-010f2f1b0476'; -- ДЦ «Умные дети» (демо)
  dream constant uuid := 'ac1849e2-daa5-45e2-91ea-774d643f1ba6'; -- источник (для сверки совпадений)
  salt  constant text := 'demo-clone-2026-08-28';                -- соль ремапа id из скрипта клонирования

  -- Пулы имён. ВАЖНО: fn_f/fn_m одинаковой длины (общий индекс), pt_f/pt_m тоже.
  fn_f constant text[] := ARRAY[
    'Анна','Мария','Елена','Ольга','Наталья','Ирина','Светлана','Татьяна','Екатерина','Юлия',
    'Анастасия','Дарья','Ксения','Алина','Виктория','Полина','Вероника','Валерия','Марина','Людмила',
    'Галина','Оксана','Надежда','Вера','Любовь','Алёна','Евгения','Кристина','Диана','Софья',
    'Маргарита','Лилия','Регина','Элина','Жанна','Инна','Лариса','Тамара','Зоя','Нина'];
  fn_m constant text[] := ARRAY[
    'Александр','Дмитрий','Сергей','Андрей','Алексей','Максим','Иван','Михаил','Николай','Егор',
    'Павел','Владимир','Денис','Тимур','Артём','Илья','Кирилл','Роман','Виктор','Олег',
    'Игорь','Владислав','Константин','Степан','Фёдор','Глеб','Матвей','Никита','Пётр','Юрий',
    'Вадим','Антон','Григорий','Руслан','Станислав','Эдуард','Валентин','Марк','Лев','Семён'];
  -- Фамилии в мужской форме; женская = + 'а' (только склоняемые на -ов/-ев/-ин)
  sn constant text[] := ARRAY[
    'Иванов','Петров','Сидоров','Смирнов','Кузнецов','Попов','Васильев','Соколов','Михайлов','Новиков',
    'Фёдоров','Морозов','Волков','Алексеев','Лебедев','Семёнов','Егоров','Павлов','Козлов','Степанов',
    'Николаев','Орлов','Андреев','Макаров','Никитин','Захаров','Зайцев','Соловьёв','Борисов','Яковлев',
    'Григорьев','Романов','Воробьёв','Сергеев','Фролов','Александров','Дмитриев','Королёв','Гусев','Киселёв',
    'Ильин','Максимов','Поляков','Комаров','Виноградов','Белов','Медведев','Антонов','Тарасов','Жуков',
    'Баранов','Филиппов','Мартынов','Богданов','Суханов','Крылов','Щербаков','Блинов','Панов','Савельев'];
  pt_m constant text[] := ARRAY[
    'Александрович','Дмитриевич','Сергеевич','Андреевич','Алексеевич','Максимович','Иванович','Михайлович','Николаевич','Павлович',
    'Владимирович','Денисович','Артёмович','Ильич','Кириллович','Романович','Викторович','Олегович','Игоревич','Владиславович',
    'Константинович','Фёдорович','Никитич','Петрович','Юрьевич','Вадимович','Антонович','Григорьевич','Русланович','Станиславович'];
  pt_f constant text[] := ARRAY[
    'Александровна','Дмитриевна','Сергеевна','Андреевна','Алексеевна','Максимовна','Ивановна','Михайловна','Николаевна','Павловна',
    'Владимировна','Денисовна','Артёмовна','Ильинична','Кирилловна','Романовна','Викторовна','Олеговна','Игоревна','Владиславовна',
    'Константиновна','Фёдоровна','Никитична','Петровна','Юрьевна','Вадимовна','Антоновна','Григорьевна','Руслановна','Станиславовна'];

  n bigint; expected bigint;
BEGIN
  IF array_length(fn_f,1) <> array_length(fn_m,1) OR array_length(pt_f,1) <> array_length(pt_m,1) THEN
    RAISE EXCEPTION 'пулы имён/отчеств разной длины';
  END IF;

  ---------------------------------------------------------------------------
  -- 1. Клиенты: пол + семейная фамилия + имя + отчество (fam переиспользуется детьми)
  ---------------------------------------------------------------------------
  CREATE TEMP TABLE fam ON COMMIT DROP AS
  SELECT id AS client_id,
         1 + floor(random() * array_length(sn,   1))::int AS sidx,
         (random() < 0.8)                                 AS fem,
         1 + floor(random() * array_length(fn_f, 1))::int AS fidx,
         1 + floor(random() * array_length(pt_f, 1))::int AS pidx
  FROM clients WHERE tenant_id = sok;

  SELECT count(*) INTO expected FROM clients WHERE tenant_id = sok;

  UPDATE clients c SET
    last_name  = CASE WHEN c.last_name  IS NOT NULL
                      THEN sn[f.sidx] || CASE WHEN f.fem THEN 'а' ELSE '' END END,
    first_name = CASE WHEN c.first_name IS NOT NULL
                      THEN CASE WHEN f.fem THEN fn_f[f.fidx] ELSE fn_m[f.fidx] END END,
    patronymic = CASE WHEN c.patronymic IS NOT NULL
                      THEN CASE WHEN f.fem THEN pt_f[f.pidx] ELSE pt_m[f.pidx] END END
  FROM fam f
  WHERE c.id = f.client_id AND c.tenant_id = sok;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> expected THEN RAISE EXCEPTION 'clients: обновлено % из %', n, expected; END IF;
  RAISE NOTICE 'ФИО клиентов: %', n;

  ---------------------------------------------------------------------------
  -- 2. Подопечные: имя по полу ребёнка, фамилия — семейная (от родителя)
  ---------------------------------------------------------------------------
  CREATE TEMP TABLE wr ON COMMIT DROP AS
  SELECT id AS ward_id, client_id,
         (random() < 0.5)                                 AS fem,
         1 + floor(random() * array_length(fn_f, 1))::int AS fidx
  FROM wards WHERE tenant_id = sok;

  SELECT count(*) INTO expected FROM wards WHERE tenant_id = sok;

  UPDATE wards w SET
    first_name = CASE WHEN r.fem THEN fn_f[r.fidx] ELSE fn_m[r.fidx] END,
    last_name  = CASE WHEN w.last_name IS NOT NULL
                      THEN sn[f.sidx] || CASE WHEN r.fem THEN 'а' ELSE '' END END
  FROM wr r JOIN fam f ON f.client_id = r.client_id
  WHERE w.id = r.ward_id AND w.tenant_id = sok;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> expected THEN RAISE EXCEPTION 'wards: обновлено % из %', n, expected; END IF;
  RAISE NOTICE 'ФИО подопечных: %', n;

  ---------------------------------------------------------------------------
  -- 3. Клонированные сотрудники Dream (только *.dm)
  ---------------------------------------------------------------------------
  CREATE TEMP TABLE er ON COMMIT DROP AS
  SELECT id AS emp_id,
         (random() < 0.8)                                 AS fem,
         1 + floor(random() * array_length(fn_f, 1))::int AS fidx,
         1 + floor(random() * array_length(sn,   1))::int AS sidx,
         1 + floor(random() * array_length(pt_f, 1))::int AS pidx
  FROM employees WHERE tenant_id = sok AND login LIKE '%.dm';

  SELECT count(*) INTO expected FROM employees WHERE tenant_id = sok AND login LIKE '%.dm';

  UPDATE employees e SET
    first_name  = CASE WHEN r.fem THEN fn_f[r.fidx] ELSE fn_m[r.fidx] END,
    last_name   = sn[r.sidx] || CASE WHEN r.fem THEN 'а' ELSE '' END,
    middle_name = CASE WHEN e.middle_name IS NOT NULL
                       THEN CASE WHEN r.fem THEN pt_f[r.pidx] ELSE pt_m[r.pidx] END END
  FROM er r
  WHERE e.id = r.emp_id AND e.tenant_id = sok;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> expected THEN RAISE EXCEPTION 'employees: обновлено % из %', n, expected; END IF;
  RAISE NOTICE 'ФИО сотрудников .dm: %', n;

  ---------------------------------------------------------------------------
  -- 4. GUARD: случайные полные совпадения с оригиналами Dream — в пределах шума
  ---------------------------------------------------------------------------
  SELECT count(*) INTO n
  FROM clients d
  JOIN clients s ON s.id = md5(d.id::text || salt)::uuid
  WHERE d.tenant_id = dream AND s.tenant_id = sok
    AND s.last_name  IS NOT DISTINCT FROM d.last_name
    AND s.first_name IS NOT DISTINCT FROM d.first_name
    AND (d.last_name IS NOT NULL OR d.first_name IS NOT NULL);
  RAISE NOTICE 'клиенты: случайных полных совпадений с оригиналом: %', n;
  IF n > 40 THEN RAISE EXCEPTION 'слишком много совпадений ФИО клиентов: %', n; END IF;

  SELECT count(*) INTO n
  FROM wards d
  JOIN wards s ON s.id = md5(d.id::text || salt)::uuid
  WHERE d.tenant_id = dream AND s.tenant_id = sok
    AND s.first_name IS NOT DISTINCT FROM d.first_name
    AND s.last_name  IS NOT DISTINCT FROM d.last_name;
  RAISE NOTICE 'подопечные: случайных полных совпадений: %', n;
  IF n > 60 THEN RAISE EXCEPTION 'слишком много совпадений ФИО подопечных: %', n; END IF;

  SELECT count(*) INTO n
  FROM employees d
  JOIN employees s ON s.id = md5(d.id::text || salt)::uuid
  WHERE d.tenant_id = dream AND s.tenant_id = sok
    AND s.first_name = d.first_name AND s.last_name = d.last_name;
  RAISE NOTICE 'сотрудники: случайных полных совпадений: %', n;
  IF n > 1 THEN RAISE EXCEPTION 'совпадения ФИО сотрудников с оригиналом: %', n; END IF;

  RAISE NOTICE 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ';
END
$main$;

COMMIT;

-- Примеры результата (вымышленные данные — печатать безопасно)
SELECT c.last_name AS parent_ln, c.first_name AS parent_fn, c.patronymic,
       w.last_name AS child_ln, w.first_name AS child_fn
FROM clients c JOIN wards w ON w.client_id = c.id
WHERE c.tenant_id = '0c7d15e7-d8e5-451c-b0ef-010f2f1b0476' AND c.last_name IS NOT NULL
LIMIT 6;
