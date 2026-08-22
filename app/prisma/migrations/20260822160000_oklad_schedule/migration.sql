-- История оклада сотрудника: версия = «с этой даты оклад стал таким».
--
-- Плоское Employee.monthly_salary при правке пересчитывало все прошлые месяцы новой
-- суммой (Андреева, ДЦ Умный Я: оклад 0 с августа обнулил июнь и июль, а выплаты и
-- списания за них остались → фантомные −36 000 ₽). Employee.oklad_from закрывал
-- только начало оклада, но не смену суммы.
--
-- Базовая величина (monthly_salary + oklad_from) остаётся «версией с начала времён»,
-- поэтому бэкфилл не нужен: без строк в этой таблице расчёт не меняется ни на рубль.
-- Логика выбора суммы на день — app/src/lib/salary/oklad-for-period.ts.

-- CreateTable
CREATE TABLE "oklad_schedules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "oklad_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oklad_schedules_tenant_id_employee_id_effective_from_idx" ON "oklad_schedules"("tenant_id", "employee_id", "effective_from");

-- AddForeignKey
ALTER TABLE "oklad_schedules" ADD CONSTRAINT "oklad_schedules_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
