-- READ-ONLY: платежи и измерения абонементов клиента (для сверки оплат).
\set cid 'e6922923-1f2f-46cb-9c0d-46f5747d647d'

-- Платежи по абонементам клиента (что реально оплачено на каждый абонемент)
SELECT p.subscription_id, p.type, p.amount, p.method, p.date, p.comment
FROM payments p
WHERE p.client_id = :'cid' AND p.deleted_at IS NULL
ORDER BY p.date;

-- Сводка: сумма transfer_in (оплачено с баланса) на каждый абонемент vs final/balance
SELECT s.id, s.status, s.final_amount, s.balance, s.charged_amount,
       COALESCE((SELECT SUM(p.amount) FROM payments p
                 WHERE p.subscription_id = s.id AND p.type='transfer_in' AND p.deleted_at IS NULL),0) AS paid_transfer_in,
       COALESCE((SELECT SUM(p.amount) FROM payments p
                 WHERE p.subscription_id = s.id AND p.type='refund' AND p.deleted_at IS NULL),0) AS refunded,
       s.direction_id, s.group_id, s.ward_id
FROM subscriptions s
WHERE s.client_id = :'cid'
ORDER BY s.created_at;
