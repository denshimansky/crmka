-- Фикс 13.07.2026: два фантомных разовых списания от 28.05.2026 («Умные дети»).
-- Занятие перенесли/отметку удалили ДО появления откатов personal_lesson_charge
-- (дыра isMove, закрыта в коде 13.07.2026) — списания остались без отметки и
-- без парного возврата. Компенсируем attendance_revert'ом и выравниваем баланс.
-- Идемпотентно: маркер в comment защищает от повторного применения.
BEGIN;

WITH phantom AS (
  SELECT t.*
  FROM client_balance_transactions t
  WHERE t.id IN (
    'faf8717d-b789-49a0-87b9-53a52d5275cc', -- −800, клиент 5f76d348…
    '92a0c8ba-5dc1-4b46-af61-e3e3b34d4a15'  -- −950, клиент b38a2490…
  )
    AND t.type = 'personal_lesson_charge'
    AND t.attendance_id IS NULL AND t.lesson_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM client_balance_transactions r
      WHERE r.client_id = t.client_id AND r.type = 'attendance_revert'
        AND r.comment LIKE 'Компенсация фантомного%'
    )
)
INSERT INTO client_balance_transactions
  (id, tenant_id, client_id, type, amount, comment, created_by, created_at, balance_after, direction_id)
SELECT gen_random_uuid(), p.tenant_id, p.client_id, 'attendance_revert', -p.amount,
       'Компенсация фантомного разового списания от 28.05.2026 (отметка удалена без возврата)',
       p.created_by, NOW(), c.client_balance - p.amount, p.direction_id
FROM phantom p
JOIN clients c ON c.id = p.client_id;

UPDATE clients c
SET client_balance = c.client_balance - t.amount, updated_at = NOW()
FROM client_balance_transactions t
WHERE t.id IN (
  'faf8717d-b789-49a0-87b9-53a52d5275cc',
  '92a0c8ba-5dc1-4b46-af61-e3e3b34d4a15'
)
  AND c.id = t.client_id
  AND EXISTS (
    SELECT 1 FROM client_balance_transactions r
    WHERE r.client_id = t.client_id AND r.type = 'attendance_revert'
      AND r.comment LIKE 'Компенсация фантомного%'
      AND r.created_at > NOW() - INTERVAL '1 minute'
  );

-- Контроль: балансы после фикса (ожидаем 0.00 и 1500.00)
SELECT c.id, c.client_balance
FROM clients c
WHERE c.id IN ('5f76d348-e68a-46a0-98d5-5bfd67d547b0', 'b38a2490-1a86-463c-ab76-1c3cb4784e98');

COMMIT;
