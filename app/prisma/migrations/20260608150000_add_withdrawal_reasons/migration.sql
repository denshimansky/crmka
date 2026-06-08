-- Справочник причин отчисления
CREATE TABLE "withdrawal_reasons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_reasons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "withdrawal_reasons_tenant_id_idx" ON "withdrawal_reasons"("tenant_id");

ALTER TABLE "withdrawal_reasons" ADD CONSTRAINT "withdrawal_reasons_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Связь Subscription → WithdrawalReason
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_withdrawal_reason_id_fkey"
    FOREIGN KEY ("withdrawal_reason_id") REFERENCES "withdrawal_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Связь Client → WithdrawalReason
ALTER TABLE "clients" ADD CONSTRAINT "clients_withdrawal_reason_id_fkey"
    FOREIGN KEY ("withdrawal_reason_id") REFERENCES "withdrawal_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Предустановленные причины (для каждой существующей организации)
INSERT INTO "withdrawal_reasons" ("tenant_id", "name", "is_system", "sort_order")
SELECT o.id, wr.name, true, wr.sort_order
FROM "organizations" o
CROSS JOIN (VALUES
    ('Закончил курс', 1),
    ('Ушёл с направления', 2),
    ('Переезд', 3),
    ('Не подошёл педагог', 4),
    ('Финансы', 5),
    ('Другое', 6)
) AS wr(name, sort_order);
