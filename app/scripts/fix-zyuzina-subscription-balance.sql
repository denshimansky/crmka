-- Коррекция фантомного долга 850₽: абонемент 21ddbe06 (Зюзина Юлия / ребёнок
-- Милана Зюзина) оплачен 3200/3200 (transfer_in: 850 от 08.06 + 2350 от 12.06),
-- но balance завис на 850 и статус остался pending из-за бага пересчёта при
-- создании/удалении скидок (repriceSubscription потерял первый платёж 850).
-- Приводим абонемент к реально оплаченному состоянию.
--   • Денежные проводки НЕ создаём — оплаты уже проведены (в выручку/ДДС не лезем).
--   • Client.clientBalance НЕ трогаем — он корректно = 0.
--   • Эффект для отчётов: уходит фантомный долг из «должников», абонемент активен.
BEGIN;

UPDATE subscriptions
SET balance = 0,
    status = 'active',
    activated_at = COALESCE(activated_at, TIMESTAMP '2026-06-12 00:00:00')
WHERE id = '21ddbe06-c717-44f6-bdd0-158e927573f0'
  AND status = 'pending'
  AND balance = 850.00;

-- Зачисление ребёнка в группе → оплачено (paymentStatus active).
UPDATE group_enrollments
SET payment_status = 'active'
WHERE id = 'b47ee743-ec26-461e-a9c2-9d87ca8d2414'
  AND is_active = true
  AND payment_status = 'awaiting_payment';

COMMIT;
