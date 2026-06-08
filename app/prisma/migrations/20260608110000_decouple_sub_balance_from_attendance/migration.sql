-- Разделяем «balance» и «chargedAmount» в Subscription:
--   balance        = finalAmount − сумма реальных оплат (Payment.transfer_in).
--                    Это «сколько ещё нужно списать с баланса родителя».
--   chargedAmount  = сумма Attendance.chargeAmount по этому абонементу.
--                    Это «сколько отработано / израсходовано занятиями».
--
-- До этого attendance.create уменьшал balance и наращивал chargedAmount,
-- то есть отработка «автооплачивала» абонемент. Это конфликтовало с правилом
-- «оплата только вручную через Оплатить с баланса».
--
-- Скрипт пересчитывает оба поля для всех активных/ожидающих абонементов
-- по новой формуле, чтобы существующие данные пришли в согласие с кодом.

BEGIN;

-- 1. Пересчёт balance = max(0, finalAmount − paidToSub)
UPDATE subscriptions s SET balance = GREATEST(
  0,
  s.final_amount - COALESCE((
    SELECT SUM(p.amount)
    FROM payments p
    WHERE p.subscription_id = s.id
      AND p.deleted_at IS NULL
      AND p.type = 'transfer_in'
  ), 0)
)
WHERE s.deleted_at IS NULL
  AND s.status IN ('pending', 'active');

-- 2. Пересчёт chargedAmount = sum(attendance.chargeAmount)
UPDATE subscriptions s SET charged_amount = COALESCE((
  SELECT SUM(a.charge_amount)
  FROM attendances a
  WHERE a.subscription_id = s.id
), 0)
WHERE s.deleted_at IS NULL;

-- 3. Активация: если по pending абонементу balance стал 0 и есть хоть один
--    transfer_in платёж — переводим в active с activatedAt = max(payment.date).
UPDATE subscriptions s SET
  status = 'active',
  activated_at = (
    SELECT MAX(p.date)::timestamp
    FROM payments p
    WHERE p.subscription_id = s.id
      AND p.deleted_at IS NULL
      AND p.type = 'transfer_in'
  )
WHERE s.deleted_at IS NULL
  AND s.status = 'pending'
  AND s.balance = 0
  AND EXISTS (
    SELECT 1 FROM payments p
    WHERE p.subscription_id = s.id
      AND p.deleted_at IS NULL
      AND p.type = 'transfer_in'
  );

COMMIT;
