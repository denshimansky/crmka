-- Ретро-пересчёт 13.07.2026: применение постоянной скидки клиента (kind=permanent,
-- активный не-легаси шаблон из карточки) к уже сделанным разовым списаниям.
-- Решение владельца 13.07.2026. С этой даты скидка применяется кодом при отметке
-- (oneOffPriceWithDiscount); скрипт выравнивает исторические списания.
-- Возврат = процент/фикс от charge_amount; attendance.charge_amount уменьшается,
-- разница возвращается на баланс родителя attendance_revert'ом.
-- Идемпотентно: маркер в comment, привязка к attendance_id.
-- ЗП педагога за эти отметки не пересчитывается (снимок).
BEGIN;

WITH target AS (
  SELECT a.id AS att_id, a.tenant_id, a.client_id, a.lesson_id,
         CASE WHEN dt.value_type = 'percent' THEN ROUND(a.charge_amount * dt.value / 100, 2)
              ELSE LEAST(a.charge_amount, dt.value) END AS refund
  FROM attendances a
  JOIN clients cl ON cl.id = a.client_id
  JOIN discount_templates dt ON dt.id = cl.discount_template_id
  WHERE a.subscription_id IS NULL AND a.is_pending = false AND a.charge_amount > 0
    AND dt.is_active AND dt.kind = 'permanent' AND dt.is_legacy = false
    AND NOT EXISTS (
      SELECT 1 FROM client_balance_transactions r
      WHERE r.attendance_id = a.id AND r.type = 'attendance_revert'
        AND r.comment LIKE 'Ретро-пересчёт разового%'
    )
)
INSERT INTO client_balance_transactions
  (id, tenant_id, client_id, type, amount, comment, created_at, balance_after, lesson_id, attendance_id)
SELECT gen_random_uuid(), t.tenant_id, t.client_id, 'attendance_revert', t.refund,
       'Ретро-пересчёт разового по постоянной скидке клиента (13.07.2026)',
       NOW(), c.client_balance + t.refund, t.lesson_id, t.att_id
FROM target t
JOIN clients c ON c.id = t.client_id
WHERE t.refund > 0;

UPDATE attendances a
SET charge_amount = a.charge_amount - r.amount, updated_at = NOW()
FROM client_balance_transactions r
WHERE r.attendance_id = a.id AND r.type = 'attendance_revert'
  AND r.comment LIKE 'Ретро-пересчёт разового%'
  AND r.created_at > NOW() - INTERVAL '1 minute';

UPDATE clients c
SET client_balance = c.client_balance + s.total, updated_at = NOW()
FROM (
  SELECT client_id, SUM(amount) AS total
  FROM client_balance_transactions
  WHERE type = 'attendance_revert' AND comment LIKE 'Ретро-пересчёт разового%'
    AND created_at > NOW() - INTERVAL '1 minute'
  GROUP BY client_id
) s
WHERE c.id = s.client_id;

-- Контроль: затронутые клиенты и новые суммы отметок
SELECT cl.last_name || ' ' || cl.first_name AS client, cl.client_balance, a.charge_amount
FROM client_balance_transactions r
JOIN clients cl ON cl.id = r.client_id
JOIN attendances a ON a.id = r.attendance_id
WHERE r.type = 'attendance_revert' AND r.comment LIKE 'Ретро-пересчёт разового%';

COMMIT;
