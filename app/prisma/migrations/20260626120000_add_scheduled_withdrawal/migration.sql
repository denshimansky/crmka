-- Отложенное отчисление абонемента (дата отчисления в будущем).
-- Абонемент остаётся active до даты X; cron finalize-scheduled-withdrawals
-- на X+1 проводит финальную сверку и переводит в withdrawn.
ALTER TABLE "subscriptions"
  ADD COLUMN "scheduled_withdrawal_date" DATE,
  ADD COLUMN "scheduled_withdrawal_reason_id" UUID,
  ADD COLUMN "scheduled_withdrawal_comment" TEXT;

CREATE INDEX "subscriptions_tenant_id_scheduled_withdrawal_date_idx"
  ON "subscriptions" ("tenant_id", "scheduled_withdrawal_date");
