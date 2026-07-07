-- ============================================================================
-- СКАН (read-only): фантомный долг из-за «Уваж. пропуск»/«Перерасчёт»
-- (consumed-семантика, фикс 07.07.2026).
--
-- Запуск на msk1:
--   ssh root@201.51.1.81 "docker exec -i crmka-db-1 psql -U crmka -d crmka" < app/scripts/scan-excused-phantom-debt.sql
--
-- До деплоя фикса finalAmount/balance живых календарных абонементов НЕ учитывают
-- финальные несписывающие отметки (excused/recalculation/кастомные) — система
-- ждёт оплату пропущенных занятий. Скан показывает масштаб и делит кейсы:
--   A. привязанные отметки (subscription_id задан) — починит fix-скрипт/reprice;
--   B. непривязанные (subscription_id IS NULL, из сетки «Посещения») — сначала
--      нужен бэкфилл привязки (fix-excused-link-marks.sql);
--   C. переплата (paid > новый finalAmount) — НЕ чинить SQL'ом: возврат на баланс
--      родителя должен пройти через приложение (перещёлкнуть отметку в UI);
--   D. legacy-абонементы (discount_source='legacy') — reprice их пропускает,
--      решение отдельно.
-- ============================================================================

-- Несписывающие расходующие типы (consumed без списания)
WITH consuming_nocharge_types AS (
  SELECT id, name, code
  FROM attendance_types
  WHERE charges_subscription = false
    AND code NOT IN ('no_show', 'makeup_scheduled', 'makeup')
)
SELECT '0. Типы, расходующие занятие без списания' AS section,
       code, name, id::text
FROM consuming_nocharge_types;

-- 1. Масштаб: живые календарные абонементы с ПРИВЯЗАННЫМИ несписывающими
--    расходующими отметками + расчёт нового баланса по формуле фикса.
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
  WHERE a.subscription_id IS NOT NULL
    AND a.is_pending = false
  GROUP BY a.subscription_id
),
paid AS (
  SELECT p.subscription_id, COALESCE(SUM(p.amount), 0) AS paid_sum
  FROM payments p
  WHERE p.deleted_at IS NULL
    AND (p.type = 'transfer_in' OR (p.type = 'refund' AND p.amount < 0))
  GROUP BY p.subscription_id
),
affected AS (
  SELECT s.id, s.tenant_id, s.status, s.discount_source,
         s.period_year, s.period_month,
         s.total_lessons, s.lesson_price, s.discount_per_lesson,
         s.charged_amount, s.final_amount, s.balance,
         m.nocharge_cnt, m.charged_cnt,
         COALESCE(p.paid_sum, 0) AS paid_sum,
         s.charged_amount
           + GREATEST(0, s.total_lessons - m.charged_cnt - m.nocharge_cnt)
             * GREATEST(0, s.lesson_price - s.discount_per_lesson) AS new_final
  FROM subscriptions s
  JOIN marks m ON m.subscription_id = s.id AND m.nocharge_cnt > 0
  LEFT JOIN paid p ON p.subscription_id = s.id
  WHERE s.deleted_at IS NULL
    AND s.type = 'calendar'
    AND s.status IN ('active', 'pending')
)
SELECT '1. Привязанные (кейс A/C/D)' AS section,
       COUNT(*) AS subs_total,
       COUNT(*) FILTER (WHERE discount_source = 'legacy') AS legacy_cnt,
       COUNT(*) FILTER (WHERE discount_source <> 'legacy' AND new_final >= paid_sum) AS simple_fix_cnt,
       COUNT(*) FILTER (WHERE discount_source <> 'legacy' AND new_final < paid_sum) AS overpaid_cnt,
       SUM(balance - GREATEST(0, new_final - paid_sum))
         FILTER (WHERE discount_source <> 'legacy') AS phantom_debt_total
FROM affected;

-- 2. Детально по привязанным (для ручной проверки; топ-50 по фантомному долгу)
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
SELECT '2. Детально' AS section,
       s.id::text AS subscription_id,
       c.last_name || ' ' || COALESCE(c.first_name, '') AS client,
       s.period_month || '.' || s.period_year AS period,
       s.status, s.discount_source,
       s.total_lessons, m.charged_cnt, m.nocharge_cnt,
       s.final_amount, s.balance,
       COALESCE(p.paid_sum, 0) AS paid_sum,
       s.charged_amount
         + GREATEST(0, s.total_lessons - m.charged_cnt - m.nocharge_cnt)
           * GREATEST(0, s.lesson_price - s.discount_per_lesson) AS new_final,
       CASE
         WHEN s.discount_source = 'legacy' THEN 'D: legacy — отдельное решение'
         WHEN s.charged_amount
              + GREATEST(0, s.total_lessons - m.charged_cnt - m.nocharge_cnt)
                * GREATEST(0, s.lesson_price - s.discount_per_lesson)
              < COALESCE(p.paid_sum, 0)
           THEN 'C: переплата — чинить через UI (перещёлкнуть отметку)'
         ELSE 'A: простой — fix-excused-reprice-simple.sql'
       END AS fix_case
FROM subscriptions s
JOIN marks m ON m.subscription_id = s.id AND m.nocharge_cnt > 0
JOIN clients c ON c.id = s.client_id
LEFT JOIN paid p ON p.subscription_id = s.id
WHERE s.deleted_at IS NULL
  AND s.type = 'calendar'
  AND s.status IN ('active', 'pending')
ORDER BY s.balance DESC
LIMIT 50;

-- 3. Кейс B: непривязанные несписывающие расходующие отметки, которые однозначно
--    резолвятся в живой календарный абонемент по (клиент, подопечный, группа, месяц).
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
  SELECT o.attendance_id, COUNT(s.id) AS candidates, MIN(s.id::text) AS sub_id
  FROM orphan o
  LEFT JOIN subscriptions s
    ON s.client_id = o.client_id
   AND s.group_id = o.group_id
   AND (s.ward_id = o.ward_id OR (s.ward_id IS NULL AND o.ward_id IS NULL))
   AND s.period_year = o.y AND s.period_month = o.m
   AND s.type = 'calendar'
   AND s.deleted_at IS NULL
   AND s.status IN ('active', 'pending')
  GROUP BY o.attendance_id
)
SELECT '3. Непривязанные отметки (кейс B)' AS section,
       COUNT(*) AS orphan_marks_total,
       COUNT(*) FILTER (WHERE candidates = 1) AS resolvable_unique,
       COUNT(*) FILTER (WHERE candidates > 1) AS ambiguous,
       COUNT(*) FILTER (WHERE candidates = 0) AS no_live_sub
FROM resolved;

-- 4. Конкретный кейс с багрепорта: Самотейкин / Свитин Егор (июль 2026)
SELECT '4. Самотейкин/Свитин' AS section,
       s.id::text AS subscription_id, s.status, s.discount_source,
       s.total_lessons, s.final_amount, s.balance, s.charged_amount,
       (SELECT COUNT(*) FROM attendances a
         JOIN attendance_types t ON t.id = a.attendance_type_id
        WHERE a.subscription_id = s.id AND a.is_pending = false
          AND t.charges_subscription = false
          AND t.code NOT IN ('no_show','makeup_scheduled','makeup')) AS nocharge_marks,
       (SELECT COUNT(*) FROM attendances a
        WHERE a.subscription_id = s.id) AS marks_total
FROM subscriptions s
JOIN clients c ON c.id = s.client_id
WHERE c.phone LIKE '%9184743263%'
  AND s.deleted_at IS NULL
ORDER BY s.created_at DESC;
