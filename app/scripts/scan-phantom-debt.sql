-- READ-ONLY: ищем тот же баг по всей базе — живой абонемент, оплаченный
-- полностью (нетто transfer_in минус refund >= final_amount), но balance > 0.
-- Ограничиваем charged_amount=0 (без отметок), где balance обязан = final-netPaid,
-- чтобы не ловить ложные срабатывания от списаний за занятия.
WITH paid AS (
  SELECT s.id, s.tenant_id, s.client_id, s.status, s.final_amount, s.balance,
         COALESCE((SELECT SUM(p.amount) FROM payments p
                   WHERE p.subscription_id=s.id AND p.type='transfer_in' AND p.deleted_at IS NULL),0)
       - COALESCE((SELECT SUM(p.amount) FROM payments p
                   WHERE p.subscription_id=s.id AND p.type='refund' AND p.deleted_at IS NULL),0) AS net_paid
  FROM subscriptions s
  WHERE s.status IN ('pending','active') AND s.deleted_at IS NULL AND s.charged_amount = 0
)
SELECT count(*) AS phantom_debt_subs,
       COALESCE(SUM(balance),0) AS total_phantom_debt
FROM paid
WHERE net_paid >= final_amount AND balance > 0;

-- Детализация (до 50 строк)
WITH paid AS (
  SELECT s.id, s.tenant_id, s.client_id, s.status, s.final_amount, s.balance,
         COALESCE((SELECT SUM(p.amount) FROM payments p
                   WHERE p.subscription_id=s.id AND p.type='transfer_in' AND p.deleted_at IS NULL),0)
       - COALESCE((SELECT SUM(p.amount) FROM payments p
                   WHERE p.subscription_id=s.id AND p.type='refund' AND p.deleted_at IS NULL),0) AS net_paid
  FROM subscriptions s
  WHERE s.status IN ('pending','active') AND s.deleted_at IS NULL AND s.charged_amount = 0
)
SELECT tenant_id, id, status, final_amount, net_paid, balance
FROM paid
WHERE net_paid >= final_amount AND balance > 0
ORDER BY balance DESC
LIMIT 50;
