-- ============================================================================
-- ФИКС ДАННЫХ (msk1): фантомный долг «Уваж. пропуск»/«Перерасчёт»
-- (consumed-семантика, код-фикс 07.07.2026).
--
-- ЗАПУСКАТЬ ТОЛЬКО ПОСЛЕ ДЕПЛОЯ код-фикса и ПОСЛЕ прогона
-- scan-excused-phantom-debt.sql (понять масштаб и кейсы).
--
-- Что делает (в одной транзакции, с guard-бэкапом для отката):
--   Шаг 1 (кейс B): привязывает непривязанные несписывающие расходующие отметки
--          (из сетки «Посещения») к ОДНОЗНАЧНО резолвящемуся живому календарному
--          абонементу (клиент+подопечный+группа+месяц, ровно 1 кандидат).
--   Шаг 2 (кейс A): пересчитывает finalAmount/discountAmount/balance живых
--          НЕ-legacy календарных абонементов с несписывающими расходующими
--          отметками по формуле фикса — ТОЛЬКО там, где нет переплаты
--          (new_final >= paid): возврат денег обязан идти через приложение.
--   Кейсы C (переплата) и D (legacy) НЕ трогает — их список даёт скан.
--
-- ОТКАТ (если что-то пошло не так, до DROP бэкапов):
--   UPDATE attendances a SET subscription_id = NULL
--     FROM _bak_excused_linked b WHERE b.attendance_id = a.id;
--   UPDATE subscriptions s SET final_amount = b.final_amount,
--       discount_amount = b.discount_amount, balance = b.balance, status = b.status
--     FROM _bak_excused_subs b WHERE b.id = s.id;
-- ============================================================================

BEGIN;

-- ── Шаг 1: бэкап + привязка непривязанных отметок (кейс B) ──
CREATE TABLE IF NOT EXISTS _bak_excused_linked AS
WITH consuming_nocharge_types AS (
  SELECT id FROM attendance_types
  WHERE charges_subscription = false
    AND code NOT IN ('no_show', 'makeup_scheduled', 'makeup')
),
orphan AS (
  SELECT a.id AS attendance_id, a.client_id, a.ward_id, l.group_id,
         EXTRACT(YEAR FROM COALESCE(l.rescheduled_from_date, l.date))::int AS y,
         EXTRACT(MONTH FROM COALESCE(l.rescheduled_from_date, l.date))::int AS m
  FROM attendances a
  JOIN lessons l ON l.id = a.lesson_id
  WHERE a.subscription_id IS NULL
    AND a.is_pending = false
    AND a.is_trial = false
    AND a.attendance_type_id IN (SELECT id FROM consuming_nocharge_types)
),
resolved AS (
  SELECT o.attendance_id,
         (ARRAY_AGG(s.id))[1] AS sub_id,
         COUNT(s.id) AS candidates
  FROM orphan o
  JOIN subscriptions s
    ON s.client_id = o.client_id
   AND s.group_id = o.group_id
   AND (s.ward_id = o.ward_id OR (s.ward_id IS NULL AND o.ward_id IS NULL))
   AND s.period_year = o.y AND s.period_month = o.m
   AND s.type = 'calendar'
   AND s.deleted_at IS NULL
   AND s.status IN ('active', 'pending')
  GROUP BY o.attendance_id
  HAVING COUNT(s.id) = 1
)
SELECT r.attendance_id, r.sub_id, now() AS backed_up_at
FROM resolved r
-- уникальный ключ (tenant, lesson, subscription): не привязываем, если у этого
-- абонемента уже есть отметка на том же занятии (исторический дубль)
WHERE NOT EXISTS (
  SELECT 1 FROM attendances a2
  JOIN attendances a1 ON a1.id = r.attendance_id
  WHERE a2.subscription_id = r.sub_id
    AND a2.lesson_id = a1.lesson_id
);

UPDATE attendances a
SET subscription_id = b.sub_id
FROM _bak_excused_linked b
WHERE b.attendance_id = a.id
  AND a.subscription_id IS NULL;

-- ── Шаг 2: бэкап + пересчёт денег (кейс A, без переплаты, не legacy) ──
CREATE TABLE IF NOT EXISTS _bak_excused_subs AS
WITH consuming_nocharge_types AS (
  SELECT id FROM attendance_types
  WHERE charges_subscription = false
    AND code NOT IN ('no_show', 'makeup_scheduled', 'makeup')
),
marks AS (
  SELECT a.subscription_id,
         COUNT(*) FILTER (WHERE a.attendance_type_id IN (SELECT id FROM consuming_nocharge_types)) AS nocharge_cnt,
         COUNT(*) FILTER (WHERE at2.charges_subscription) AS charged_cnt
  FROM attendances a
  JOIN attendance_types at2 ON at2.id = a.attendance_type_id
  WHERE a.subscription_id IS NOT NULL AND a.is_pending = false
  GROUP BY a.subscription_id
),
paid AS (
  SELECT p.subscription_id, COALESCE(SUM(p.amount), 0) AS paid_sum
  FROM payments p
  WHERE p.deleted_at IS NULL
    AND (p.type = 'transfer_in' OR (p.type = 'refund' AND p.amount < 0))
  GROUP BY p.subscription_id
)
SELECT s.id, s.status, s.final_amount, s.discount_amount, s.balance,
       m.nocharge_cnt, m.charged_cnt, COALESCE(p.paid_sum, 0) AS paid_sum,
       s.charged_amount
         + GREATEST(0, s.total_lessons - m.charged_cnt - m.nocharge_cnt)
           * GREATEST(0, s.lesson_price - s.discount_per_lesson) AS new_final,
       GREATEST(0,
         s.total_amount
         - (s.charged_amount
            + GREATEST(0, s.total_lessons - m.charged_cnt - m.nocharge_cnt)
              * GREATEST(0, s.lesson_price - s.discount_per_lesson))
         - s.lesson_price * m.nocharge_cnt) AS new_discount,
       now() AS backed_up_at
FROM subscriptions s
JOIN marks m ON m.subscription_id = s.id AND m.nocharge_cnt > 0
LEFT JOIN paid p ON p.subscription_id = s.id
WHERE s.deleted_at IS NULL
  AND s.type = 'calendar'
  AND s.status IN ('active', 'pending')
  AND s.discount_source <> 'legacy'
  -- только без переплаты: возврат на баланс родителя — через приложение
  AND s.charged_amount
      + GREATEST(0, s.total_lessons - m.charged_cnt - m.nocharge_cnt)
        * GREATEST(0, s.lesson_price - s.discount_per_lesson)
      >= COALESCE(p.paid_sum, 0);

UPDATE subscriptions s
SET final_amount   = b.new_final,
    discount_amount = b.new_discount,
    balance        = b.new_final - b.paid_sum,
    updated_at     = now()
FROM _bak_excused_subs b
WHERE b.id = s.id;

-- Долг погашен пропусками у pending → активируем (side-эффекты заявок «won»
-- здесь не проводим — это только статус; заявка, если была, дозакроется при
-- следующем действии в приложении. При желании активацию можно сделать в UI.)
-- Сознательно НЕ активируем автоматически: оставляем отчёт для ручного решения.
SELECT 'pending с погашенным долгом (решить активацию вручную/в UI)' AS info,
       s.id::text, s.balance
FROM subscriptions s
JOIN _bak_excused_subs b ON b.id = s.id
WHERE s.status = 'pending' AND s.balance <= 0;

-- Контрольный итог
SELECT 'linked marks' AS what, COUNT(*) FROM _bak_excused_linked
UNION ALL
SELECT 'repriced subs', COUNT(*) FROM _bak_excused_subs;

COMMIT;

-- После проверки (несколько дней) бэкапы можно удалить:
-- DROP TABLE _bak_excused_linked; DROP TABLE _bak_excused_subs;
