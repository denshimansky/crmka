-- ============================================================================
-- ФИКС ДАННЫХ (msk1): возврат переплаты за «Уваж. пропуск» по УЖЕ ЗАКРЫТОМУ
-- абонементу Лескиной (июнь 2026).
--
-- Контекст: 8 занятий × 450 ₽, оплачено 3600 ₽. 5 «Был» (списано 2250 ₽) +
-- 3 «Уваж. пропуск» (16/18/19 июня, проставлены 22–23 июня — ДО код-фикса
-- 07.07.2026, поэтому reprice их не пересчитал). Абонемент авто-закрыт кроном,
-- который ДО этого фикса не делал денежную сверку → 1350 ₽ не вернулись.
--
-- Скрипт зеркалит closeSubscription: delta = net-оплачено − списано − прошлые
-- возвраты = 1350 ₽ → subscription_closed_refund на баланс + строка в историю.
-- Все проверки в DO-блоке: при любом несовпадении — RAISE EXCEPTION и полный
-- откат транзакции (деньги молча не двигаются).
--
-- ОТКАТ (если нужно после коммита):
--   DELETE FROM client_balance_transactions
--     WHERE subscription_id='bae7e2fe-e4ec-41e5-9db6-0df3f58d5901'
--       AND type='subscription_closed_refund';
--   DELETE FROM communications
--     WHERE client_id='8a2fc711-6ec0-4111-8d9b-8d3dd308c865'
--       AND content LIKE 'Абонемент «Каллиграфия» (06.2026) закрыт%';
--   UPDATE clients SET client_balance = 0.00
--     WHERE id='8a2fc711-6ec0-4111-8d9b-8d3dd308c865';
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant     uuid := '8e4f73c7-01ef-4296-893f-e49e286f81e9';
  v_client     uuid := '8a2fc711-6ec0-4111-8d9b-8d3dd308c865';
  v_sub        uuid := 'bae7e2fe-e4ec-41e5-9db6-0df3f58d5901';
  v_dir        uuid;
  v_status     text;
  v_net_paid   numeric;
  v_used       numeric;
  v_prior      numeric;
  v_delta      numeric;
  v_bal_before numeric;
  v_bal_after  numeric;
BEGIN
  SELECT direction_id, status INTO v_dir, v_status
  FROM subscriptions WHERE id = v_sub AND tenant_id = v_tenant AND deleted_at IS NULL;
  IF v_dir IS NULL THEN RAISE EXCEPTION 'Абонемент не найден'; END IF;
  IF v_status <> 'closed' THEN RAISE EXCEPTION 'Ожидали closed, получили %', v_status; END IF;

  -- net-оплачено (netPaidToSubscription): transfer_in + отрицательные refund.
  SELECT COALESCE(SUM(amount),0) INTO v_net_paid FROM payments
  WHERE subscription_id = v_sub AND deleted_at IS NULL
    AND (type = 'transfer_in' OR (type = 'refund' AND amount < 0));
  -- списано (Σ charge_amount).
  SELECT COALESCE(SUM(charge_amount),0) INTO v_used FROM attendances WHERE subscription_id = v_sub;
  -- прошлые возвраты закрытия — защита от повторного возврата.
  SELECT COALESCE(SUM(amount),0) INTO v_prior FROM client_balance_transactions
  WHERE subscription_id = v_sub AND type = 'subscription_closed_refund';

  v_delta := v_net_paid - v_used - v_prior;
  IF v_delta <> 1350.00 THEN
    RAISE EXCEPTION 'Ожидали дельту 1350, получили % (net_paid=%, used=%, prior=%)',
      v_delta, v_net_paid, v_used, v_prior;
  END IF;

  SELECT client_balance INTO v_bal_before FROM clients WHERE id = v_client;
  IF v_bal_before <> 0.00 THEN RAISE EXCEPTION 'Ожидали баланс 0, получили %', v_bal_before; END IF;
  v_bal_after := v_bal_before + v_delta;

  UPDATE clients SET client_balance = v_bal_after WHERE id = v_client;

  INSERT INTO client_balance_transactions
    (id, tenant_id, client_id, type, amount, balance_after, subscription_id, direction_id, comment, created_by, created_at)
  VALUES
    (gen_random_uuid(), v_tenant, v_client, 'subscription_closed_refund', v_delta, v_bal_after, v_sub, v_dir,
     'Закрытие: возврат на баланс ' || to_char(v_delta,'FM999990.00') || ' ₽ (ретро-фикс: 3 «Уваж. пропуск» не пересчитаны до 07.07.2026)',
     NULL, now());

  INSERT INTO communications
    (id, tenant_id, client_id, type, channel, direction, content, employee_id, created_at)
  VALUES
    (gen_random_uuid(), v_tenant, v_client, 'note', 'internal', 'internal',
     'Абонемент «Каллиграфия» (06.2026) закрыт. Возврат на баланс родителя: ' || to_char(v_delta,'FM999990.00') || ' ₽.',
     NULL, now());

  RAISE NOTICE 'OK: возврат % ₽, баланс % -> %', v_delta, v_bal_before, v_bal_after;
END $$;

-- Контроль после (в той же транзакции).
SELECT c.client_balance,
  (SELECT COUNT(*) FROM client_balance_transactions
     WHERE subscription_id='bae7e2fe-e4ec-41e5-9db6-0df3f58d5901' AND type='subscription_closed_refund') AS refund_tx,
  (SELECT COUNT(*) FROM communications
     WHERE client_id='8a2fc711-6ec0-4111-8d9b-8d3dd308c865'
       AND content LIKE 'Абонемент «Каллиграфия» (06.2026) закрыт%') AS notes
FROM clients c WHERE c.id='8a2fc711-6ec0-4111-8d9b-8d3dd308c865';

COMMIT;
