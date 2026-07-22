-- Баг #79: мультифилиальность клиента. Второй из двух последних РАЗНЫХ филиалов
-- абонементов. Вместе с last_branch_id даёт видимость клиента админам обоих
-- филиалов. Nullable, бэкфилл существующих клиентов — отдельным скриптом.
ALTER TABLE "clients" ADD COLUMN "prev_branch_id" UUID;

CREATE INDEX "clients_tenant_id_prev_branch_id_idx" ON "clients"("tenant_id", "prev_branch_id");
