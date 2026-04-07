-- Расширение AuditLog по Data Dictionary v1.2
-- Переименование колонок + новые поля

-- Переименовываем entity → entity_type
ALTER TABLE "audit_logs" RENAME COLUMN "entity" TO "entity_type";

-- Делаем entity_id обязательным (UUID)
-- Сначала обновляем null-записи (если есть)
UPDATE "audit_logs" SET "entity_id" = '00000000-0000-0000-0000-000000000000' WHERE "entity_id" IS NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "entity_id" SET NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "entity_id" TYPE uuid USING "entity_id"::uuid;

-- Переименовываем details → changes
ALTER TABLE "audit_logs" RENAME COLUMN "details" TO "changes";

-- Добавляем новые поля
ALTER TABLE "audit_logs" ADD COLUMN "is_after_period_close" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "audit_logs" ADD COLUMN "ip_address" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "user_agent" TEXT;

-- Добавляем FK constraints
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Добавляем составной индекс
CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_idx" ON "audit_logs"("tenant_id", "entity_type", "entity_id");
