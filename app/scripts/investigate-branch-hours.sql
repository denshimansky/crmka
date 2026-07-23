-- READ-ONLY: настройки рабочего времени филиалов (для отчёта загруженности).
SELECT name, working_hours_start, working_hours_end, working_days,
       (SELECT count(*) FROM rooms r WHERE r.branch_id = b.id AND r.deleted_at IS NULL) AS rooms
FROM branches b
WHERE deleted_at IS NULL
ORDER BY name;
