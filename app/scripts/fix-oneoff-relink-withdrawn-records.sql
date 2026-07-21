-- ============================================================================
-- ФИКС ЗАПИСЕЙ (msk1, ВСЕ орг): records-only перепривязка разовых к ОТЧИСЛЕННЫМ
-- абонементам. БЕЗ ДВИЖЕНИЯ ДЕНЕГ (ни одной транзакции баланса).
--
-- Контекст: занятие в рамках месяца было отмечено разовым (subscription_id=NULL),
-- слот абонемента остался «неотхоженным». Абонемент затем отчислён, и финализация
-- уже вернула стоимость слота на баланс (subscription_closed_refund) — деньги в
-- ноль гасятся разовым списанием. Поэтому здесь НЕ трогаем баланс: только чиним
-- записи, чтобы отчёты выручки/посещаемости показывали занятие как абонементное.
--
-- Делает (одна транзакция, с бэкапом _bak_relink_w):
--   1) привязывает разовую отметку к отчисленному абонементу (subscription_id);
--   2) += charged_amount абонемента (денормализованный счётчик отхоженного) —
--      СТРОГО по строкам, реально привязанным шагом 1 (RETURNING), не по «плану».
--   НИ balance, ни final, ни client_balance, ни client_balance_transactions.
--
-- Берём ТОЛЬКО «чистые» отметки:
--   • charge_amount = эффективной цене занятия (цена − скидка);
--   • charged_amount + Σ(перепривязок по абонементу) <= final_amount.
-- Исключены 2 шт (ДЦ Easy d8c4f0d4: разовое 450 ≠ эфф.290.40; ДЦ Умный Я legacy
-- d222d4a6: legacy final 2800 < 3150) — требуют денежного решения, здесь не трогаем.
--
-- ⚠ ВАЖНО (латентный риск, ревью 21.07): у 14 перепривязанных отчисленных
--   абонементов usedAmount формулы отчисления теперь включает привязанную
--   отметку, а гасящая пара (−P разовое / +P возврат отчисления) остаётся. Пока
--   абонемент withdrawn — деньги не двигаются (крон и PATCH не пересверяют
--   отчисленный). Но РУЧНАЯ реактивация withdrawn→active с последующим повторным
--   отчислением спишет ложный долг −P. Эти 14 абонементов (см. _bak_relink_w)
--   НЕ реактивировать. Долговременный фикс (guard в формуле / нейтрализация пары)
--   — отдельно, вне этой records-only миграции.
--
-- ОТКАТ:
--   UPDATE attendances a SET subscription_id=NULL FROM _bak_relink_w b WHERE b.att_id=a.id;
--   UPDATE subscriptions s SET charged_amount=charged_amount-x.total FROM
--     (SELECT sub_id, SUM(charge_amount) total FROM _bak_relink_w GROUP BY sub_id) x WHERE s.id=x.sub_id;
--   (после закрытия окна отката) DROP TABLE _bak_relink_w;
-- ============================================================================

BEGIN;

CREATE TEMP TABLE _relink_w AS
WITH oneoff AS (
  SELECT a.id AS att_id, a.tenant_id, a.client_id, a.ward_id, a.charge_amount, a.lesson_id,
         COALESCE(l.rescheduled_from_date, l.date) AS ldate, l.group_id
  FROM attendances a JOIN lessons l ON l.id=a.lesson_id
  WHERE a.subscription_id IS NULL AND a.is_pending=false AND a.charge_amount>0 AND a.is_trial=false
),
cover AS (
  SELECT DISTINCT ON (o.att_id) o.att_id, o.tenant_id, o.client_id, o.charge_amount, o.lesson_id,
         s.id AS sub_id, s.status, s.withdrawal_date, o.ldate,
         s.charged_amount, s.final_amount, s.lesson_price, s.discount_per_lesson
  FROM oneoff o
  JOIN subscriptions s ON s.tenant_id=o.tenant_id AND s.client_id=o.client_id AND s.group_id=o.group_id
    AND (s.ward_id=o.ward_id OR (s.ward_id IS NULL AND o.ward_id IS NULL))
    AND s.type='calendar' AND s.deleted_at IS NULL
    AND s.period_year=EXTRACT(YEAR FROM o.ldate)::int AND s.period_month=EXTRACT(MONTH FROM o.ldate)::int
  -- детерминированный тай-брейк: приоритет живых, затем позже отчисленный, затем id
  ORDER BY o.att_id, CASE s.status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 WHEN 'closed' THEN 2 WHEN 'withdrawn' THEN 4 END,
           s.withdrawal_date DESC NULLS LAST, s.id
),
w AS (SELECT * FROM cover WHERE status='withdrawn' AND ldate <= withdrawal_date),
persub AS (SELECT sub_id, SUM(charge_amount) rt, MAX(charged_amount) sc, MAX(final_amount) sf FROM w GROUP BY sub_id)
SELECT wv.att_id, wv.tenant_id, wv.client_id, wv.charge_amount, wv.lesson_id, wv.sub_id
FROM w wv JOIN persub p ON p.sub_id=wv.sub_id
WHERE wv.charge_amount = GREATEST(0, wv.lesson_price - wv.discount_per_lesson)
  AND (p.sc + p.rt) <= p.sf;

-- guard: ровно 14 целей
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM _relink_w;
  IF n <> 14 THEN RAISE EXCEPTION 'Ожидали 14 чистых records-перепривязок, получили %', n; END IF;
END $$;

-- guard: нет дублей внутри набора по (lesson, sub) — иначе шаг 1 нарушит unique-индекс
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM (SELECT lesson_id, sub_id FROM _relink_w GROUP BY lesson_id, sub_id HAVING count(*)>1) q;
  IF n > 0 THEN RAISE EXCEPTION 'Дубли внутри набора: % пар (lesson, sub)', n; END IF;
END $$;

-- guard: у абонемента ещё нет отметки на этом занятии (существующий конфликт unique-ключа)
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM _relink_w r JOIN attendances a2 ON a2.lesson_id=r.lesson_id AND a2.subscription_id=r.sub_id;
  IF n > 0 THEN RAISE EXCEPTION 'Конфликт unique-ключа: % отметок уже на абонементе', n; END IF;
END $$;

CREATE TABLE IF NOT EXISTS _bak_relink_w AS SELECT r.*, now() AS backed_up_at FROM _relink_w r;

-- 1) привязать отметку к отчисленному абонементу; фиксируем РЕАЛЬНО привязанные строки
CREATE TEMP TABLE _attached AS
WITH upd AS (
  UPDATE attendances a SET subscription_id=r.sub_id, updated_at=now()
  FROM _relink_w r WHERE a.id=r.att_id AND a.subscription_id IS NULL
  RETURNING a.id AS att_id, a.subscription_id AS sub_id, a.charge_amount
)
SELECT * FROM upd;

-- guard: привязано ровно 14 (иначе кто-то параллельно занял строку — откатываемся)
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM _attached;
  IF n <> 14 THEN RAISE EXCEPTION 'Привязано % строк вместо 14 (конкурентная запись?) — откат', n; END IF;
END $$;

-- 2) += charged_amount СТРОГО по фактически привязанным строкам (final/balance НЕ трогаем)
UPDATE subscriptions s SET charged_amount=s.charged_amount+x.total, updated_at=now()
FROM (SELECT sub_id, SUM(charge_amount) total FROM _attached GROUP BY sub_id) x
WHERE s.id=x.sub_id;

-- контроль: баланс клиентов НЕ изменился (никаких новых транзакций)
SELECT o.name AS org, COUNT(*) AS relinked, SUM(a.charge_amount) AS moved_to_subs
FROM _attached a
JOIN attendances at2 ON at2.id=a.att_id
JOIN organizations o ON o.id=at2.tenant_id GROUP BY o.name ORDER BY o.name;

COMMIT;
