-- Пер-организационный оверрайд флага «Разрешить отчисление» для системных
-- (глобальных, tenant_id=NULL) видов посещений. Общая строка одна на весь SaaS,
-- поэтому организация хранит своё значение здесь. Отсутствие строки = наследуется
-- дефолт с attendance_types.allow_subscription_withdrawal. Таблица аддитивная,
-- backfill не нужен: до первого переключения флага поведение не меняется.

CREATE TABLE "attendance_type_withdrawal_overrides" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "attendance_type_id" UUID NOT NULL,
    "allow_subscription_withdrawal" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_type_withdrawal_overrides_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_type_withdrawal_overrides_tenant_id_idx"
    ON "attendance_type_withdrawal_overrides"("tenant_id");

CREATE UNIQUE INDEX "attendance_type_withdrawal_overrides_tenant_type_key"
    ON "attendance_type_withdrawal_overrides"("tenant_id", "attendance_type_id");

ALTER TABLE "attendance_type_withdrawal_overrides"
    ADD CONSTRAINT "attendance_type_withdrawal_overrides_attendance_type_id_fkey"
    FOREIGN KEY ("attendance_type_id") REFERENCES "attendance_types"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS для паритета с остальными таблицами (на проде app ходит owner-ролью и GUC
-- не ставится — реальная изоляция на app-layer через where:{tenantId}). У этой
-- таблицы tenant_id всегда NOT NULL, поэтому system_types_visible не нужна.
ALTER TABLE "attendance_type_withdrawal_overrides" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "attendance_type_withdrawal_overrides"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "attendance_type_withdrawal_overrides"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');
