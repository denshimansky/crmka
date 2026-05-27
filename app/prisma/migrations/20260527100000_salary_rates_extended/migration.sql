-- C12 (Ф3 фундамент): 5 схем ставок ЗП + плавающая матрица + ставка группы

-- Расширение enum SalaryScheme
ALTER TYPE "SalaryScheme" ADD VALUE IF NOT EXISTS 'percent_of_payments';
ALTER TYPE "SalaryScheme" ADD VALUE IF NOT EXISTS 'floating_by_students';

-- SalaryRate: добавляем процент для схемы percent_of_payments + updated_at + индекс для быстрого резолва
ALTER TABLE "salary_rates"
  ADD COLUMN "percent_of_payments" DECIMAL(5, 2),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT NOW();

CREATE INDEX "salary_rates_tenant_id_employee_id_direction_id_idx"
  ON "salary_rates"("tenant_id", "employee_id", "direction_id");

-- GroupSalaryRate: ставка для конкретной группы (1:1 с group),
-- перебивает личные ставки всех педагогов на занятиях этой группы.
CREATE TABLE "group_salary_rates" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           UUID NOT NULL,
  "group_id"            UUID NOT NULL UNIQUE,
  "scheme"              "SalaryScheme" NOT NULL,
  "rate_per_student"    DECIMAL(12, 2),
  "rate_per_lesson"     DECIMAL(12, 2),
  "fixed_per_shift"     DECIMAL(12, 2),
  "percent_of_payments" DECIMAL(5, 2),
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "group_salary_rates_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "groups"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "group_salary_rates_tenant_id_idx"
  ON "group_salary_rates"("tenant_id");

-- SalaryBracket: одна строка плавающей матрицы (N учеников → ставка за занятие).
-- Принадлежит ЛИБО SalaryRate, ЛИБО GroupSalaryRate (XOR).
CREATE TABLE "salary_brackets" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            UUID NOT NULL,
  "salary_rate_id"       UUID,
  "group_salary_rate_id" UUID,
  "min_students"         INTEGER NOT NULL,
  "rate_per_lesson"      DECIMAL(12, 2) NOT NULL,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "salary_brackets_salary_rate_id_fkey"
    FOREIGN KEY ("salary_rate_id") REFERENCES "salary_rates"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salary_brackets_group_salary_rate_id_fkey"
    FOREIGN KEY ("group_salary_rate_id") REFERENCES "group_salary_rates"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salary_brackets_exactly_one_parent"
    CHECK (
      (("salary_rate_id" IS NOT NULL)::int + ("group_salary_rate_id" IS NOT NULL)::int) = 1
    )
);

CREATE INDEX "salary_brackets_tenant_id_salary_rate_id_idx"
  ON "salary_brackets"("tenant_id", "salary_rate_id");

CREATE INDEX "salary_brackets_tenant_id_group_salary_rate_id_idx"
  ON "salary_brackets"("tenant_id", "group_salary_rate_id");
