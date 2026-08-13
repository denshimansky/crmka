-- Модель Анны (13.08.2026): второй ручной филиал в карточке клиента.
-- Жёсткая ручная привязка 1–2 филиалов; видимость клиента админом филиала =
-- branch_id ИЛИ second_branch_id (+ страховка по живому абонементу,
-- см. lib/client-segments.ts). Nullable; бэкфилл существующих клиентов из
-- истории абонементов/заявок — отдельным скриптом.
ALTER TABLE "clients" ADD COLUMN "second_branch_id" UUID;

CREATE INDEX "clients_tenant_id_second_branch_id_idx" ON "clients"("tenant_id", "second_branch_id");

ALTER TABLE "clients" ADD CONSTRAINT "clients_second_branch_id_fkey" FOREIGN KEY ("second_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
