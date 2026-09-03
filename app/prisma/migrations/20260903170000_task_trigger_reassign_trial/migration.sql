-- Автозадача «Переназначить пробное»: ставится, когда занятие с записанным
-- пробным отменяют (PATCH /api/lessons/[id] со status=cancelled и
-- подтверждением). Зеркалит missed_makeup для отработок.
-- Аддитивно: новое значение enum, существующие строки не трогаются.
ALTER TYPE "TaskAutoTrigger" ADD VALUE IF NOT EXISTS 'reassign_trial';
