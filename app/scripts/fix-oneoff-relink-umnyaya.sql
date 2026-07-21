-- ============================================================================
-- ФИКС ДАННЫХ (msk1, только ДЦ Умный Я): перепривязка разовых посещений к
-- ЖИВЫМ (pending/active) абонементам, покрывающим тот же месяц+группу.
--
-- Баг (код уже починен): занятие в рамках месяца абонемента списывалось как
-- РАЗОВОЕ (personal_lesson_charge с баланса), а слот абонемента оставался
-- «неотхоженным». Родитель платил дважды: разовым И абонементом. Для ЖИВЫХ
-- абонементов деньги сами не сойдутся (pending не авто-закрывается).
--
-- Что делает (одна транзакция, с бэкапом _bak_relink_oneoff):
--   1) привязывает разовую отметку к абонементу (subscription_id = sub);
--   2) += charged_amount абонемента (final/balance НЕ меняются — при полной
--      эффективной цене занятие переходит из «остатка» в «списанные», сумма
--      инвариантна: final = charged + цена×остаток);
--   3) возвращает разовое списание на баланс родителя (attendance_revert).
--
-- ТОЛЬКО status IN (pending, active): отчисленные абонементы уже сверены
-- финализацией (деньги сошлись), их не трогаем.
--
-- ОТКАТ:
--   UPDATE attendances a SET subscription_id=NULL FROM _bak_relink_oneoff b WHERE b.att_id=a.id;
--   UPDATE subscriptions s SET charged_amount=charged_amount-x.total FROM
--     (SELECT sub_id, SUM(charge_amount) total FROM _bak_relink_oneoff GROUP BY sub_id) x WHERE s.id=x.sub_id;
--   DELETE FROM client_balance_transactions WHERE attendance_id IN (SELECT att_id FROM _bak_relink_oneoff) AND type='attendance_revert' AND comment LIKE 'Перепривязка разового%';
--   UPDATE clients c SET client_balance=client_balance-x.total FROM
--     (SELECT client_id, SUM(charge_amount) total FROM _bak_relink_oneoff GROUP BY client_id) x WHERE c.id=x.client_id;
-- ============================================================================

BEGIN;

CREATE TEMP TABLE _relink AS
WITH oneoff AS (
  SELECT a.id AS att_id, a.tenant_id, a.client_id, a.ward_id, a.charge_amount, a.lesson_id,
         g.direction_id, COALESCE(l.rescheduled_from_date, l.date) AS ldate
  FROM attendances a
  JOIN lessons l ON l.id=a.lesson_id
  JOIN groups g ON g.id=l.group_id
  WHERE a.subscription_id IS NULL AND a.is_pending=false AND a.charge_amount>0 AND a.is_trial=false
    AND a.tenant_id='8e4f73c7-01ef-4296-893f-e49e286f81e9'
),
cover AS (
  SELECT DISTINCT ON (o.att_id) o.att_id, o.tenant_id, o.client_id, o.ward_id, o.charge_amount,
         o.lesson_id, o.direction_id, s.id AS sub_id, s.status
  FROM oneoff o
  JOIN subscriptions s ON s.tenant_id=o.tenant_id AND s.client_id=o.client_id
    AND s.group_id=(SELECT group_id FROM lessons WHERE id=o.lesson_id)
    AND (s.ward_id=o.ward_id OR (s.ward_id IS NULL AND o.ward_id IS NULL))
    AND s.type='calendar' AND s.deleted_at IS NULL
    AND s.period_year=EXTRACT(YEAR FROM o.ldate)::int AND s.period_month=EXTRACT(MONTH FROM o.ldate)::int
  ORDER BY o.att_id, CASE s.status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 WHEN 'closed' THEN 2 WHEN 'withdrawn' THEN 4 END
)
SELECT att_id, tenant_id, client_id, ward_id, charge_amount, lesson_id, direction_id, sub_id
FROM cover WHERE status IN ('pending','active');

-- guard: ровно 7 целей
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM _relink;
  IF n <> 7 THEN RAISE EXCEPTION 'Ожидали 7 разовых к перепривязке, получили %', n; END IF;
END $$;

-- guard: у абонемента нет уже привязанной отметки на том же занятии (unique key)
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM _relink r
  JOIN attendances a2 ON a2.lesson_id=r.lesson_id AND a2.subscription_id=r.sub_id;
  IF n > 0 THEN RAISE EXCEPTION 'Конфликт unique-ключа: % отметок уже на абонементе', n; END IF;
END $$;

CREATE TABLE IF NOT EXISTS _bak_relink_oneoff AS SELECT r.*, now() AS backed_up_at FROM _relink r;

-- 1) привязать отметку к абонементу
UPDATE attendances a SET subscription_id=r.sub_id, updated_at=now()
FROM _relink r WHERE a.id=r.att_id AND a.subscription_id IS NULL;

-- 2) += charged_amount (final/balance инвариантны)
UPDATE subscriptions s SET charged_amount=s.charged_amount+x.total, updated_at=now()
FROM (SELECT sub_id, SUM(charge_amount) total FROM _relink GROUP BY sub_id) x
WHERE s.id=x.sub_id;

-- 3) вернуть разовое списание на баланс родителя (attendance_revert, с running balance_after)
WITH ordered AS (
  SELECT r.*,
    SUM(r.charge_amount) OVER (PARTITION BY r.client_id ORDER BY r.att_id ROWS UNBOUNDED PRECEDING) AS cum
  FROM _relink r
),
bal AS (SELECT id, client_balance FROM clients WHERE id IN (SELECT DISTINCT client_id FROM _relink))
INSERT INTO client_balance_transactions
  (id, tenant_id, client_id, type, amount, balance_after, subscription_id, lesson_id, attendance_id, direction_id, comment, created_by, created_at)
SELECT gen_random_uuid(), o.tenant_id, o.client_id, 'attendance_revert', o.charge_amount,
       b.client_balance + o.cum, o.sub_id, o.lesson_id, o.att_id, o.direction_id,
       'Перепривязка разового к абонементу: возврат разового списания', NULL, now()
FROM ordered o JOIN bal b ON b.id=o.client_id;

-- 4) поднять баланс родителя
UPDATE clients c SET client_balance=c.client_balance+x.total
FROM (SELECT client_id, SUM(charge_amount) total FROM _relink GROUP BY client_id) x
WHERE c.id=x.client_id;

-- контроль
SELECT c.last_name, cl.client_balance AS new_balance,
  (SELECT COUNT(*) FROM attendances a WHERE a.subscription_id=r.sub_id AND a.id IN (SELECT att_id FROM _relink)) AS relinked,
  s.charged_amount, s.final_amount, s.balance AS sub_balance
FROM _relink r
JOIN clients c ON c.id=r.client_id JOIN clients cl ON cl.id=r.client_id
JOIN subscriptions s ON s.id=r.sub_id
GROUP BY c.last_name, cl.client_balance, r.sub_id, s.charged_amount, s.final_amount, s.balance
ORDER BY c.last_name;

COMMIT;
