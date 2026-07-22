-- Оплата пробных занятий педагогу перенесена из настройки организации в ставку
-- педагога (SalaryRate). Добавляем колонку и переносим текущее значение из
-- организации во все её ставки, чтобы поведение сохранилось.

ALTER TABLE "salary_rates" ADD COLUMN "trial_pay_mode" TEXT NOT NULL DEFAULT 'none';

UPDATE "salary_rates" sr
SET "trial_pay_mode" = o."trial_pay_mode"
FROM "organizations" o
WHERE o."id" = sr."tenant_id";
