-- Новый автотриггер задач: напоминание за день до первого платного занятия
-- (клиенты с неоплаченным абонементом).
ALTER TYPE "TaskAutoTrigger" ADD VALUE IF NOT EXISTS 'first_paid_reminder';
