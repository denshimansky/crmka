-- READ-ONLY: природа пробных у won-заявок июня (легитимны или «налипли» бэкфиллом).

\echo '== A. Статусы пробных у won-заявок июня + совпадает ли ребёнок заявки и пробного =='
SELECT t.status,
       count(*)                                            AS trials,
       count(*) FILTER (WHERE t.ward_id IS DISTINCT FROM a.ward_id) AS ward_mismatch,
       count(*) FILTER (WHERE t.scheduled_date > a.processed_at)    AS trial_after_won
FROM applications a
JOIN trial_lessons t ON t.application_id = a.id AND t.status <> 'cancelled'
WHERE a.deleted_at IS NULL
  AND a.processed_to_status = 'won'
  AND a.processed_at >= DATE '2026-06-01'
  AND a.processed_at <  DATE '2026-07-01'
GROUP BY t.status
ORDER BY t.status;

\echo '== B. Когда созданы пробные у won-заявок (бэкфилл-привязка vs органика) =='
SELECT date_trunc('day', t.created_at)::date AS trial_created_day, count(*)
FROM applications a
JOIN trial_lessons t ON t.application_id = a.id AND t.status <> 'cancelled'
WHERE a.deleted_at IS NULL
  AND a.processed_to_status = 'won'
  AND a.processed_at >= DATE '2026-06-01'
  AND a.processed_at <  DATE '2026-07-01'
GROUP BY 1 ORDER BY 1;

\echo '== C. 6 клиентов «купил по first_paid_lesson_date без won»: есть ли у них заявки и пробные =='
SELECT c.id,
       c.first_paid_lesson_date,
       (SELECT count(*) FROM applications a
          WHERE a.client_id = c.id AND a.deleted_at IS NULL) AS apps,
       (SELECT count(*) FROM applications a
          JOIN trial_lessons t ON t.application_id = a.id AND t.status <> 'cancelled'
          WHERE a.client_id = c.id AND a.deleted_at IS NULL) AS apps_with_trial
FROM clients c
WHERE c.deleted_at IS NULL
  AND c.first_paid_lesson_date >= DATE '2026-06-01'
  AND c.first_paid_lesson_date <  DATE '2026-07-01'
  AND NOT EXISTS (SELECT 1 FROM applications a
                  WHERE a.client_id = c.id AND a.processed_to_status = 'won' AND a.deleted_at IS NULL)
ORDER BY c.first_paid_lesson_date;

\echo '== D. Пробные-сироты (application_id IS NULL) НЕотменённые — потеряны для отчёта =='
SELECT t.status, count(*)
FROM trial_lessons t
WHERE t.application_id IS NULL AND t.status <> 'cancelled'
GROUP BY t.status ORDER BY t.status;

\echo '== E. Все активные заявки БЕЗ пробного: их стадии (кто эти «без пробного») =='
SELECT a.stage, count(*)
FROM applications a
WHERE a.deleted_at IS NULL AND a.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM trial_lessons t
                  WHERE t.application_id = a.id AND t.status <> 'cancelled')
GROUP BY a.stage ORDER BY a.stage;
