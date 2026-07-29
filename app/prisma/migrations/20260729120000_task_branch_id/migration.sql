-- Денормализованный филиал задачи (ADM-04). Для задач без клиента (авто-задача
-- «Отметить занятие») это единственная привязка к филиалу — скоуп-админ филиала
-- должен видеть только задачи своих филиалов. Проставляется из group.branchId
-- при создании; NULL = общая/без филиала.
ALTER TABLE "tasks" ADD COLUMN "branch_id" UUID;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tasks_tenant_id_branch_id_idx" ON "tasks"("tenant_id", "branch_id");

-- Бэкфилл существующих задач «Отметить занятие» (единственный тип без клиента):
-- проставляем филиал группы, чтобы после включения филиального scope скоуп-админ
-- сразу видел задачи СВОЕГО филиала, а не терял их до следующей генерации.
-- Матч по (тенант + исполнитель = инструктор группы + точный заголовок) —
-- проверено на проде: соответствие 1:1, без неоднозначностей.
UPDATE "tasks" t
SET "branch_id" = g."branch_id"
FROM "groups" g
WHERE t."auto_trigger" = 'unmarked_lesson'
  AND t."status" = 'pending'
  AND t."deleted_at" IS NULL
  AND t."branch_id" IS NULL
  AND g."tenant_id" = t."tenant_id"
  AND g."deleted_at" IS NULL
  AND g."instructor_id" = t."assigned_to"
  AND t."title" = 'Отметить занятие: ' || g."name";
