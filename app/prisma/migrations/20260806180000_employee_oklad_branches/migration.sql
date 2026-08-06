-- Оклад по филиалам: список филиалов, на которые распространяется оклад сотрудника
-- (разнесение оклад-твина в ОПИУ). JSON-массив branchId. NULL → по всем ∝ выручке.
ALTER TABLE "employees" ADD COLUMN "oklad_branch_ids" JSONB;
