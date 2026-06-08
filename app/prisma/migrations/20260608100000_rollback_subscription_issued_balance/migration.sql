-- Откат Ф2-семантики «баланс = долг клиента» обратно к «баланс = реальные деньги».
--
-- Контекст: миграция 20260525130000_balance_ledger_extend ввела тип
-- 'subscription_issued', который при выписке любого абонемента уводил
-- Client.clientBalance в минус на сумму абонемента. Это конфликтовало
-- с продуктовой логикой:
--   * деньги клиента живут на Client.clientBalance,
--   * долг по конкретному абонементу живёт на Subscription.balance,
--   * автосписания с баланса на абонемент НЕТ — только через кнопку
--     «Оплатить с баланса» (POST /api/subscriptions/[id]/pay-from-balance).
--
-- Скрипт пересчитывает clientBalance, игнорируя проводки subscription_issued.
-- Сами проводки в ClientBalanceTransaction остаются для истории —
-- это аудит-лог, его не чистим.
--
-- Также пересчитывает totalSubscriptionsCount: до сих пор поле инкрементировалось
-- только в clients/merge, но не при создании абонемента — у всех клиентов
-- с купленными абонементами счётчик был 0.

BEGIN;

-- 1. Пересчёт Client.clientBalance из ledger'а БЕЗ subscription_issued.
--    Это снимает «фантомный долг» от выписки абонемента.
UPDATE clients c
SET client_balance = COALESCE((
  SELECT SUM(amount)
  FROM client_balance_transactions t
  WHERE t.client_id = c.id
    AND t.type <> 'subscription_issued'
), 0);

-- 2. Пересчёт Client.totalSubscriptionsCount — реальное число абонементов.
UPDATE clients c
SET total_subscriptions_count = COALESCE((
  SELECT COUNT(*)
  FROM subscriptions s
  WHERE s.client_id = c.id AND s.deleted_at IS NULL
), 0);

-- 3. Пересчёт Client.segment по правилу 1-3 / 4-12 / 13-18 / 19+.
--    Лиды (0 абонементов) остаются в new_client — это «стартовый» сегмент.
UPDATE clients SET segment = CASE
  WHEN total_subscriptions_count BETWEEN 4 AND 12 THEN 'standard'::"ClientSegment"
  WHEN total_subscriptions_count BETWEEN 13 AND 18 THEN 'regular'::"ClientSegment"
  WHEN total_subscriptions_count >= 19 THEN 'vip'::"ClientSegment"
  ELSE 'new_client'::"ClientSegment"
END;

COMMIT;
