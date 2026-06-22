-- READ-ONLY: оценка пересчёта даты отчисления (withdrawal_date) у уже отчисленных
-- абонементов по правилу «последнее платное занятие» (любая отметка со списанием
-- с абонемента: charge_amount > 0; max(lesson.date)).
--
-- Ничего не меняет: вся диагностика в TEMP-таблице внутри BEGIN ... ROLLBACK.
-- Цель — понять масштаб расхождения текущего withdrawal_date с правилом и сколько
-- абонементов вообще без платных посещений (их авто-пересчитать нельзя).
--
-- Запуск на msk1:
--   ssh root@201.51.1.81 "cd /opt/crmka && docker compose exec -T db psql -U crmka -d crmka" \
--     < app/scripts/investigate-withdrawal-last-paid.sql

BEGIN;

-- Срез: каждый отчисленный (withdrawn) абонемент + текущая и предлагаемая дата.
CREATE TEMP TABLE w_diag AS
SELECT
  s.id,
  s.tenant_id,
  s.client_id,
  s.ward_id,
  s.group_id,
  s.withdrawal_date::date AS cur_date,
  (
    SELECT MAX(l.date)::date
    FROM attendances a
    JOIN lessons l ON l.id = a.lesson_id
    WHERE a.subscription_id = s.id
      AND a.charge_amount > 0
  ) AS proposed_date
FROM subscriptions s
WHERE s.status = 'withdrawn'
  AND s.deleted_at IS NULL;

-- 1) Сводка по масштабу.
SELECT
  count(*)                                                                              AS total_withdrawn,
  count(*) FILTER (WHERE proposed_date IS NULL)                                         AS no_paid_attendance,
  count(*) FILTER (WHERE proposed_date IS NOT NULL AND cur_date IS DISTINCT FROM proposed_date) AS would_change,
  count(*) FILTER (WHERE proposed_date IS NOT NULL AND cur_date = proposed_date)        AS already_correct,
  count(*) FILTER (WHERE cur_date IS NULL)                                              AS cur_date_null
FROM w_diag;

-- 2) Распределение по знаку и величине сдвига (cur_date − proposed_date) в днях.
SELECT
  CASE
    WHEN proposed_date IS NULL THEN 'нет платных'
    WHEN cur_date IS NULL THEN 'cur=NULL'
    WHEN cur_date = proposed_date THEN '0 (совпадает)'
    WHEN cur_date > proposed_date THEN 'cur позже (отток занижался: уход в позднем месяце)'
    ELSE 'cur раньше (редко)'
  END AS bucket,
  count(*) AS cnt,
  min(cur_date - proposed_date) AS min_diff_days,
  max(cur_date - proposed_date) AS max_diff_days
FROM w_diag
GROUP BY 1
ORDER BY cnt DESC;

-- 3) Сколько отчислений «переедет» в другой КАЛЕНДАРНЫЙ МЕСЯЦ (влияет на отчёты оттока).
SELECT
  count(*) FILTER (
    WHERE proposed_date IS NOT NULL AND cur_date IS NOT NULL
      AND date_trunc('month', cur_date) <> date_trunc('month', proposed_date)
  ) AS month_shifts
FROM w_diag;

-- 4) Образец расхождений (20 строк) для визуальной проверки.
SELECT id, cur_date, proposed_date, (cur_date - proposed_date) AS diff_days
FROM w_diag
WHERE proposed_date IS NOT NULL AND cur_date IS DISTINCT FROM proposed_date
ORDER BY abs(cur_date - proposed_date) DESC
LIMIT 20;

-- 5) Текущее состояние group_enrollments для отчисленных детей: насколько
--    withdrawn_at расходится с (proposed_date + 1). Берём активный/исторический
--    enrollment по тому же scope (client_id + ward_id + group_id).
SELECT
  count(*)                                                            AS enrollments_checked,
  count(*) FILTER (WHERE ge.withdrawn_at IS NULL)                     AS enr_withdrawn_at_null,
  count(*) FILTER (
    WHERE w_diag.proposed_date IS NOT NULL
      AND ge.withdrawn_at::date IS DISTINCT FROM (w_diag.proposed_date + 1)
  )                                                                   AS enr_would_change
FROM w_diag
JOIN group_enrollments ge
  ON ge.tenant_id = w_diag.tenant_id
 AND ge.group_id  = w_diag.group_id
 AND ge.client_id = w_diag.client_id
 AND ge.ward_id IS NOT DISTINCT FROM w_diag.ward_id
 AND ge.deleted_at IS NULL
 AND ge.is_active = false;

ROLLBACK;
