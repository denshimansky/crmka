-- Корректировка ЗП по схемам floating_by_students / per_lesson (баг 09.07.2026):
-- calcPay фиксировал ставку в момент отметки (порядок кликов) и не пересчитывал
-- при изменении состава. Скрипт приводит раскладку instructor_pay_amount к
-- целевой (как reallocate-lesson-pay.ts / computePayTargets):
--   - floating: брекет по числу уникальных фактически пришедших (payEnabled +
--     partOfFact, ВКЛЮЧАЯ пробные отметки — пробный сидел на занятии и двигал
--     порог и в calcPay), вся ставка на первой НЕ-пробной факт-отметке;
--   - per_lesson: ставка на первой оплачиваемой не-пробной отметке;
--   - пробная отметка с начисленной суммой — уже носитель ставки занятия:
--     не-пробным целям 0 (пробные суммы скрипт НЕ трогает);
--   - занятия в ВЫПЛАЧЕННЫХ периодах не трогаем (guard бросает исключение,
--     если такие попали в выборку, — их корректировать только вручную вместе
--     с SalaryAdjustment).
--
-- ПОРЯДОК ПРИМЕНЕНИЯ (msk1):
--   1) Прогнать целиком как есть — транзакция завершается ROLLBACK (скан).
--   2) Проверить сверку.
--   3) Заменить ROLLBACK на COMMIT и прогнать повторно (фикс).
-- Бэкап затронутых строк создаётся в той же транзакции и сохраняется при
-- COMMIT. Откат применённого фикса:
--   UPDATE attendances a SET instructor_pay_amount = b.old_pay
--   FROM _fix_salary_realloc_backup_20260709 b WHERE a.id = b.attendance_id;

BEGIN;

CREATE TEMP TABLE _targets ON COMMIT DROP AS
WITH eff AS (
  -- Резолв ставки как в resolve-rate.ts: групповая → личная по направлению → личная дефолтная
  SELECT l.id AS lesson_id, l.tenant_id, l.date,
         COALESCE(l.substitute_instructor_id, l.instructor_id) AS emp_id,
         COALESCE(gsr.scheme::text, sr_dir.scheme::text, sr_def.scheme::text) AS scheme,
         COALESCE(gsr.rate_per_lesson, sr_dir.rate_per_lesson, sr_def.rate_per_lesson) AS rate_per_lesson,
         CASE WHEN gsr.id IS NOT NULL THEN gsr.id END AS gsr_id,
         CASE WHEN gsr.id IS NULL THEN COALESCE(sr_dir.id, sr_def.id) END AS sr_id
  FROM lessons l
  JOIN groups g ON g.id = l.group_id
  LEFT JOIN group_salary_rates gsr ON gsr.group_id = g.id
  LEFT JOIN LATERAL (
    SELECT * FROM salary_rates sr
    WHERE sr.tenant_id = l.tenant_id
      AND sr.employee_id = COALESCE(l.substitute_instructor_id, l.instructor_id)
      AND sr.direction_id = g.direction_id LIMIT 1
  ) sr_dir ON gsr.id IS NULL
  LEFT JOIN LATERAL (
    SELECT * FROM salary_rates sr
    WHERE sr.tenant_id = l.tenant_id
      AND sr.employee_id = COALESCE(l.substitute_instructor_id, l.instructor_id)
      AND sr.direction_id IS NULL LIMIT 1
  ) sr_def ON gsr.id IS NULL AND sr_dir.id IS NULL
  WHERE l.status <> 'cancelled' AND l.is_trial = false
),
rated AS (
  SELECT * FROM eff WHERE scheme IN ('floating_by_students', 'per_lesson')
),
marks AS (
  -- Все отметки занятия, включая пробные (контекст); pending исключены
  SELECT r.lesson_id, r.tenant_id, r.scheme, r.rate_per_lesson, r.gsr_id, r.sr_id, r.emp_id, r.date,
         a.id AS attendance_id, a.client_id, a.ward_id, a.is_trial,
         a.instructor_pay_enabled AS pay_on, at.part_of_fact AS fact,
         a.instructor_pay_amount AS old_pay,
         COALESCE(a.marked_at, a.created_at) AS at_time
  FROM rated r
  JOIN attendances a ON a.lesson_id = r.lesson_id AND a.is_pending = false
  JOIN attendance_types at ON at.id = a.attendance_type_id
),
counts AS (
  SELECT lesson_id,
         COUNT(DISTINCT (client_id::text || ':' || COALESCE(ward_id::text, '')))
           FILTER (WHERE pay_on AND fact) AS n_fact,          -- включая пробных
         COUNT(*) FILTER (WHERE pay_on AND NOT is_trial) AS n_payable_regular,
         BOOL_OR(is_trial AND pay_on AND old_pay > 0) AS trial_carrier
  FROM marks GROUP BY lesson_id
),
rates AS (
  SELECT m.lesson_id,
         CASE
           WHEN c.trial_carrier THEN 0  -- ставка занятия уже на пробной отметке
           WHEN m.scheme = 'per_lesson' THEN
             CASE WHEN c.n_payable_regular > 0 THEN COALESCE(m.rate_per_lesson, 0) ELSE 0 END
           ELSE COALESCE((
             SELECT sb.rate_per_lesson FROM salary_brackets sb
             WHERE ((m.gsr_id IS NOT NULL AND sb.group_salary_rate_id = m.gsr_id)
                    OR (m.sr_id IS NOT NULL AND sb.salary_rate_id = m.sr_id))
               AND sb.min_students <= c.n_fact
             ORDER BY sb.min_students DESC LIMIT 1
           ), 0)
         END AS lesson_rate
  FROM (SELECT DISTINCT lesson_id, scheme, rate_per_lesson, gsr_id, sr_id FROM marks) m
  JOIN counts c ON c.lesson_id = m.lesson_id
),
carriers AS (
  -- Носитель — только НЕ-пробная отметка: floating — первая факт, per_lesson — первая оплачиваемая
  SELECT DISTINCT ON (m.lesson_id) m.lesson_id, m.attendance_id AS carrier_id
  FROM marks m
  WHERE m.pay_on AND NOT m.is_trial AND (m.scheme = 'per_lesson' OR m.fact)
  ORDER BY m.lesson_id, m.at_time ASC, m.attendance_id ASC
)
SELECT m.tenant_id, m.lesson_id, m.date, m.emp_id, m.attendance_id, m.old_pay,
       CASE WHEN ca.carrier_id = m.attendance_id THEN COALESCE(r.lesson_rate, 0) ELSE 0 END AS new_pay
FROM marks m
JOIN rates r ON r.lesson_id = m.lesson_id
LEFT JOIN carriers ca ON ca.lesson_id = m.lesson_id
WHERE m.is_trial = false;  -- пробные суммы не трогаем

-- GUARD: занятия выплаченных периодов не корректируем этим скриптом.
-- Если такие попали в выборку — стоп: их править только вручную с SalaryAdjustment.
DO $$
DECLARE cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt
  FROM _targets t
  JOIN salary_payments sp ON sp.tenant_id = t.tenant_id
    AND sp.employee_id = t.emp_id
    AND sp.period_year = EXTRACT(YEAR FROM t.date)::int
    AND sp.period_month = EXTRACT(MONTH FROM t.date)::int
  WHERE t.old_pay <> t.new_pay;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'Найдены изменения в выплаченных периодах (% строк) — корректировать вручную с SalaryAdjustment', cnt;
  END IF;
END $$;

-- === СКАН: что изменится ===
SELECT o.name AS org, to_char(t.date, 'YYYY-MM-DD') AS d,
       COUNT(*) AS marks_changed,
       SUM(t.old_pay) AS old_sum, SUM(t.new_pay) AS new_sum
FROM _targets t
JOIN organizations o ON o.id = t.tenant_id
WHERE t.old_pay <> t.new_pay
GROUP BY o.name, t.date
ORDER BY o.name, t.date;

-- Итог по организациям
SELECT o.name AS org, COUNT(DISTINCT t.lesson_id) AS lessons,
       SUM(t.new_pay - t.old_pay) AS delta
FROM _targets t
JOIN organizations o ON o.id = t.tenant_id
WHERE t.old_pay <> t.new_pay
GROUP BY o.name;

-- === БЭКАП затронутых строк (сохраняется при COMMIT) ===
CREATE TABLE IF NOT EXISTS _fix_salary_realloc_backup_20260709 AS
SELECT t.attendance_id, t.lesson_id, t.old_pay, t.new_pay, now() AS backed_up_at
FROM _targets t WHERE t.old_pay <> t.new_pay;

-- === ФИКС ===
UPDATE attendances a
SET instructor_pay_amount = t.new_pay
FROM _targets t
WHERE a.id = t.attendance_id AND a.is_trial = false AND t.old_pay <> t.new_pay;

-- Сверка от живых данных: сумма ЗП каждого затронутого занятия (включая
-- нетронутые пробные отметки) = ставка занятия + пробные суммы. Проверяем
-- инвариант «не больше одной ставки на не-пробных отметках».
SELECT COUNT(*) AS lessons_with_multiple_carriers
FROM (
  SELECT a.lesson_id
  FROM attendances a
  WHERE a.lesson_id IN (SELECT DISTINCT lesson_id FROM _targets)
    AND a.is_trial = false AND a.instructor_pay_amount > 0
  GROUP BY a.lesson_id
  HAVING COUNT(*) > 1
) x;

ROLLBACK; -- ← прогон-скан; для применения заменить на COMMIT;
