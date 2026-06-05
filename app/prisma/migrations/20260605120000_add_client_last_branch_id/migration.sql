-- ADM-04: денормализованный филиал последнего абонемента клиента.
-- Используется для разграничения видимости (см. lib/client-segments.ts).

ALTER TABLE "clients" ADD COLUMN "last_branch_id" UUID;

-- Backfill: для каждого клиента берём branch_id группы самого позднего
-- абонемента (по created_at). Используется CTE с DISTINCT ON для
-- максимальной производительности на больших таблицах подписок.
WITH latest AS (
    SELECT DISTINCT ON (s.client_id)
        s.client_id,
        g.branch_id
    FROM "subscriptions" s
    JOIN "groups" g ON g.id = s.group_id
    ORDER BY s.client_id, s.created_at DESC
)
UPDATE "clients" c
SET "last_branch_id" = l.branch_id
FROM latest l
WHERE c.id = l.client_id;

-- Индекс для сегментной фильтрации (clientStatus=churned/archived AND
-- last_branch_id IN (...)).
CREATE INDEX "clients_tenant_id_last_branch_id_idx"
    ON "clients" ("tenant_id", "last_branch_id");
