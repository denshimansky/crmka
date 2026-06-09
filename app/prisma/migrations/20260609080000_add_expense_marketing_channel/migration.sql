-- Канал привлечения для расходов категории «Маркетинг и реклама».
ALTER TABLE "expenses" ADD COLUMN "lead_channel_id" UUID;

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_lead_channel_id_fkey"
    FOREIGN KEY ("lead_channel_id") REFERENCES "lead_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "expenses_tenant_id_lead_channel_id_idx" ON "expenses"("tenant_id", "lead_channel_id");
