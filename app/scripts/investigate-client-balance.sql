-- READ-ONLY расследование баланса клиента Зизина (850₽).
\set cid 'e6922923-1f2f-46cb-9c0d-46f5747d647d'

-- 1) Клиент и текущий баланс
SELECT id, last_name, first_name, client_balance, client_status, funnel_status
FROM clients WHERE id = :'cid';

-- 2) Консистентность: поле clientBalance vs сумма проводок леджера
SELECT
  (SELECT client_balance FROM clients WHERE id = :'cid')        AS balance_field,
  COALESCE(SUM(amount), 0)                                       AS ledger_sum,
  (SELECT client_balance FROM clients WHERE id = :'cid') - COALESCE(SUM(amount),0) AS diff
FROM client_balance_transactions WHERE client_id = :'cid';

-- 3) Полный леджер баланса (хронология)
SELECT created_at, type, amount, balance_after, subscription_id, comment
FROM client_balance_transactions
WHERE client_id = :'cid'
ORDER BY created_at;

-- 4) История скидок по абонементам этого клиента (создание/удаление)
SELECT d.created_at, d.is_active, d.type, d.value_type, d.value,
       d.calculated_amount, d.end_date, d.subscription_id, d.comment
FROM discounts d
JOIN subscriptions s ON s.id = d.subscription_id
WHERE s.client_id = :'cid'
ORDER BY d.created_at;

-- 5) Абонементы клиента (для контекста сумм)
SELECT id, status, period_year, period_month, total_amount, discount_amount,
       final_amount, balance, charged_amount, created_at
FROM subscriptions WHERE client_id = :'cid'
ORDER BY created_at;
