-- READ-ONLY: состояние воронки ребёнка 40446b9e (для корректной активации абонемента).
\set wid '40446b9e-24ee-4af4-b556-b7be48e20cf0'

-- Зеркало стадии воронки у подопечного
SELECT id, first_name, last_name, sales_stage FROM wards WHERE id = :'wid';

-- Активные заявки ребёнка (что «выигрывается» при активации абонемента)
SELECT id, status, stage, direction_id, created_at, deleted_at
FROM applications
WHERE ward_id = :'wid'
ORDER BY created_at;

-- Зачисление этого ребёнка в группу (после бэкфилла должно быть active/awaiting_payment)
SELECT id, group_id, is_active, payment_status, enrolled_at, withdrawn_at, deleted_at
FROM group_enrollments
WHERE ward_id = :'wid'
ORDER BY enrolled_at;
