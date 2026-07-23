\set cid 'e6922923-1f2f-46cb-9c0d-46f5747d647d'
-- Абонемент после фикса
SELECT id, status, final_amount, balance, charged_amount, activated_at
FROM subscriptions WHERE id = '21ddbe06-c717-44f6-bdd0-158e927573f0';
-- Зачисление после фикса
SELECT id, is_active, payment_status FROM group_enrollments WHERE id = 'b47ee743-ec26-461e-a9c2-9d87ca8d2414';
-- Баланс клиента и консистентность леджера — должны остаться 0 / без изменений
SELECT (SELECT client_balance FROM clients WHERE id = :'cid') AS balance_field,
       COALESCE(SUM(amount),0) AS ledger_sum
FROM client_balance_transactions WHERE client_id = :'cid';
-- Контроль: нет ли теперь живых абонементов с долгом у клиента (фантом ушёл)
SELECT id, status, balance FROM subscriptions
WHERE client_id = :'cid' AND status IN ('pending','active') AND balance <> 0 AND deleted_at IS NULL;
