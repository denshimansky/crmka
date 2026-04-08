-- =============================================================================
-- RLS (Row Level Security) для мультитенантной изоляции
-- Второй уровень защиты: даже если JS-код пропустит tenantId, БД не отдаст чужие данные
-- =============================================================================

-- Создаём роль app_user (приложение должно подключаться под ней, не superuser)
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user WITH LOGIN PASSWORD 'app_password';
  END IF;
END $$;

-- Права для app_user
GRANT USAGE ON SCHEMA public TO app_user;
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_user;

-- =============================================================================
-- Включаем RLS и создаём политики для всех tenant-scoped таблиц
-- Две политики на таблицу:
--   1) tenant_isolation_policy — фильтрует по current_setting('app.current_tenant_id')
--   2) bypass_rls — пропускает всё когда tenant не установлен (миграции, seed, admin)
-- =============================================================================

-- branches
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "branches"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "branches"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- rooms
ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "rooms"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "rooms"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- employees
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "employees"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "employees"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- clients
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "clients"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "clients"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- wards
ALTER TABLE "wards" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "wards"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "wards"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- directions
ALTER TABLE "directions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "directions"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "directions"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- groups
ALTER TABLE "groups" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "groups"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "groups"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- group_schedule_templates
ALTER TABLE "group_schedule_templates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "group_schedule_templates"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "group_schedule_templates"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- lessons
ALTER TABLE "lessons" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "lessons"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "lessons"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- group_enrollments
ALTER TABLE "group_enrollments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "group_enrollments"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "group_enrollments"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- attendance_types (tenant_id is nullable — system types have NULL)
ALTER TABLE "attendance_types" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "attendance_types"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "attendance_types"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');
CREATE POLICY system_types_visible ON "attendance_types"
  USING (tenant_id IS NULL);

-- employee_branches (adding tenant_id in this migration — M-4 fix)
ALTER TABLE "employee_branches" ADD COLUMN "tenant_id" UUID;

-- Backfill tenant_id from employee
UPDATE "employee_branches" eb
SET "tenant_id" = e."tenant_id"
FROM "employees" e
WHERE eb."employee_id" = e."id";

-- Make tenant_id NOT NULL after backfill
ALTER TABLE "employee_branches" ALTER COLUMN "tenant_id" SET NOT NULL;

-- Add FK
ALTER TABLE "employee_branches"
  ADD CONSTRAINT "employee_branches_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS for employee_branches
ALTER TABLE "employee_branches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "employee_branches"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "employee_branches"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- salary_rates
ALTER TABLE "salary_rates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "salary_rates"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "salary_rates"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- salary_payments
ALTER TABLE "salary_payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "salary_payments"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "salary_payments"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- salary_adjustments
ALTER TABLE "salary_adjustments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "salary_adjustments"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "salary_adjustments"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- subscriptions
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "subscriptions"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "subscriptions"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- financial_accounts
ALTER TABLE "financial_accounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "financial_accounts"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "financial_accounts"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- payments
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "payments"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "payments"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- discounts
ALTER TABLE "discounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "discounts"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "discounts"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- attendances
ALTER TABLE "attendances" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "attendances"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "attendances"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- tasks
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "tasks"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "tasks"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- call_campaigns
ALTER TABLE "call_campaigns" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "call_campaigns"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "call_campaigns"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- call_campaign_items
ALTER TABLE "call_campaign_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "call_campaign_items"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "call_campaign_items"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- expense_categories (tenant_id is nullable — system categories have NULL)
ALTER TABLE "expense_categories" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "expense_categories"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "expense_categories"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');
CREATE POLICY system_categories_visible ON "expense_categories"
  USING (tenant_id IS NULL);

-- expenses
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "expenses"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "expenses"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- expense_branches
ALTER TABLE "expense_branches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "expense_branches"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "expense_branches"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- account_operations
ALTER TABLE "account_operations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "account_operations"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "account_operations"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- audit_logs
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "audit_logs"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "audit_logs"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- client_portal_tokens
ALTER TABLE "client_portal_tokens" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "client_portal_tokens"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "client_portal_tokens"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- periods
ALTER TABLE "periods" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "periods"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "periods"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- trial_lessons
ALTER TABLE "trial_lessons" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "trial_lessons"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "trial_lessons"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- client_balance_transactions
ALTER TABLE "client_balance_transactions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "client_balance_transactions"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "client_balance_transactions"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- production_calendar
ALTER TABLE "production_calendar" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "production_calendar"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "production_calendar"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- discount_templates
ALTER TABLE "discount_templates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "discount_templates"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "discount_templates"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- planned_expenses
ALTER TABLE "planned_expenses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "planned_expenses"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "planned_expenses"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- admin_bonus_settings
ALTER TABLE "admin_bonus_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "admin_bonus_settings"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "admin_bonus_settings"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- notifications
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "notifications"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "notifications"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- unprolonged_comments
ALTER TABLE "unprolonged_comments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "unprolonged_comments"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "unprolonged_comments"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- =============================================================================
-- M-2: Уникальный индекс на Organization.inn (где NOT NULL)
-- =============================================================================
CREATE UNIQUE INDEX "organizations_inn_unique" ON "organizations" ("inn") WHERE "inn" IS NOT NULL;

-- =============================================================================
-- M-3: Attendance unique constraint с tenantId
-- =============================================================================
DROP INDEX IF EXISTS "attendances_lesson_id_subscription_id_key";
CREATE UNIQUE INDEX "attendances_tenant_lesson_subscription_key" ON "attendances" ("tenant_id", "lesson_id", "subscription_id");

-- =============================================================================
-- M-4: EmployeeBranch unique constraint с tenantId (столбец добавлен выше)
-- =============================================================================
DROP INDEX IF EXISTS "employee_branches_employee_id_branch_id_key";
CREATE UNIQUE INDEX "employee_branches_tenant_employee_branch_key" ON "employee_branches" ("tenant_id", "employee_id", "branch_id");
