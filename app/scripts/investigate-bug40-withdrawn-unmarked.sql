-- READ-ONLY (баг #40): почему отчисленные дети всплывают в «Неотмеченных».
-- Для 6 названных детей показываем по каждому зачислению в группу:
--   is_active, enrolled_at, withdrawn_at, последнее ПЛАТНОЕ занятие (last_paid),
--   ожидаемый withdrawn_at = last_paid + 1, расхождение, и статусы абонементов.
-- Если withdrawn_at NULL при is_active=false ИЛИ withdrawn_at > last_paid+1 —
-- ребёнок будет виден в занятиях после последнего платного (баг).

BEGIN;

WITH targets AS (
  SELECT
    ge.id AS enr_id,
    ge.tenant_id, ge.group_id, ge.client_id, ge.ward_id,
    ge.is_active,
    ge.enrolled_at::date AS enrolled_at,
    ge.withdrawn_at::date AS withdrawn_at,
    COALESCE(w.last_name, c.last_name)  AS last_name,
    COALESCE(w.first_name, c.first_name) AS first_name,
    (ge.ward_id IS NOT NULL) AS is_ward,
    g.name AS group_name
  FROM group_enrollments ge
  JOIN clients c ON c.id = ge.client_id
  LEFT JOIN wards w ON w.id = ge.ward_id
  JOIN groups g ON g.id = ge.group_id
  WHERE ge.deleted_at IS NULL
    AND COALESCE(w.last_name, c.last_name) ILIKE ANY (ARRAY[
      'мухамеджанов%','рожков%','сидоров%','сайфутдинов%','осинск%','гурьянов%'
    ])
)
SELECT
  t.last_name, t.first_name, t.is_ward, t.group_name,
  t.is_active, t.enrolled_at, t.withdrawn_at,
  lp.last_paid,
  (lp.last_paid + 1) AS expected_withdrawn_at,
  CASE
    WHEN lp.last_paid IS NULL THEN 'нет платных занятий'
    WHEN t.withdrawn_at IS NULL AND t.is_active THEN 'АКТИВЕН (enrollment не отчислен)'
    WHEN t.withdrawn_at IS NULL AND NOT t.is_active THEN 'is_active=false, но withdrawn_at=NULL'
    WHEN t.withdrawn_at = lp.last_paid + 1 THEN 'OK'
    WHEN t.withdrawn_at > lp.last_paid + 1 THEN 'ПОЗЖЕ нормы на '||(t.withdrawn_at - (lp.last_paid + 1))||' дн.'
    ELSE 'раньше нормы'
  END AS verdict,
  subs.subs
FROM targets t
LEFT JOIN LATERAL (
  SELECT MAX(l.date)::date AS last_paid
  FROM attendances a
  JOIN lessons l ON l.id = a.lesson_id
  WHERE a.tenant_id = t.tenant_id
    AND l.group_id  = t.group_id
    AND a.client_id = t.client_id
    AND a.ward_id IS NOT DISTINCT FROM t.ward_id
    AND a.charge_amount > 0
) lp ON true
LEFT JOIN LATERAL (
  SELECT string_agg(
           s.status || ' wd=' || COALESCE(s.withdrawal_date::date::text, '—')
           || ' ' || to_char(make_date(s.period_year, s.period_month, 1), 'YYYY-MM'),
           '; ' ORDER BY s.period_year, s.period_month
         ) AS subs
  FROM subscriptions s
  WHERE s.tenant_id = t.tenant_id
    AND s.group_id  = t.group_id
    AND s.client_id = t.client_id
    AND s.ward_id IS NOT DISTINCT FROM t.ward_id
    AND s.deleted_at IS NULL
) subs ON true
ORDER BY t.last_name, t.first_name, t.group_name;

ROLLBACK;
