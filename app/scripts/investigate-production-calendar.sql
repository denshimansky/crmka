-- READ-ONLY: производственный календарь и тенант филиалов пользователя.
-- 1) Тенант филиалов ONLINE/Н.ПОРТ/С.ПОРТ
SELECT o.id AS tenant_id, o.name AS org,
       string_agg(b.name, ', ' ORDER BY b.name) AS branches
FROM branches b JOIN organizations o ON o.id = b.tenant_id
WHERE b.deleted_at IS NULL AND b.name IN ('ONLINE','Н.ПОРТ','С.ПОРТ')
GROUP BY o.id, o.name;

-- 2) Все записи производственного календаря за июнь 2026 (по тенантам)
SELECT pc.tenant_id, o.name AS org, pc.date, pc.is_working, pc.comment
FROM production_calendar pc JOIN organizations o ON o.id = pc.tenant_id
WHERE pc.date >= DATE '2026-06-01' AND pc.date <= DATE '2026-06-30'
ORDER BY o.name, pc.date;

-- 3) Сколько вообще записей календаря у каждого тенанта (есть ли он заполнен)
SELECT o.name AS org, count(*) AS entries,
       count(*) FILTER (WHERE pc.is_working = false) AS non_working,
       count(*) FILTER (WHERE pc.is_working = true)  AS working_overrides
FROM production_calendar pc JOIN organizations o ON o.id = pc.tenant_id
GROUP BY o.name ORDER BY o.name;
