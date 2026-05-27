-- C10: новый флаг «Доступно админу» + блокировка всех системных типов.

ALTER TABLE "attendance_types"
  ADD COLUMN "available_to_admin" BOOLEAN NOT NULL DEFAULT true;

-- Маркер «makeup» (Отработка) — он же никем не ставится вручную, это
-- bulk-маркер. Закрываем его и для админа тоже.
UPDATE "attendance_types"
SET "available_to_admin" = false
WHERE "code" = 'makeup' AND "is_system" = true;

-- Все системные строки становятся зафиксированными по бизнес-логике.
-- Через UI владельца можно менять только availableToInstructor /
-- availableToAdmin / isActive / sortOrder — остальные поля заблокированы.
UPDATE "attendance_types"
SET "is_flags_locked" = true
WHERE "is_system" = true;
