-- CreateEnum
CREATE TYPE "CommunicationType" AS ENUM ('note', 'call_incoming', 'call_outgoing', 'whatsapp_incoming', 'whatsapp_outgoing', 'sms_outgoing', 'email_outgoing', 'task_result', 'call_campaign_result');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('internal', 'phone', 'whatsapp', 'telegram', 'sms', 'email');

-- CreateEnum
CREATE TYPE "CommunicationDirection" AS ENUM ('incoming', 'outgoing', 'internal');

-- CreateTable
CREATE TABLE "communications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "type" "CommunicationType" NOT NULL,
    "channel" "CommunicationChannel" NOT NULL DEFAULT 'internal',
    "direction" "CommunicationDirection" NOT NULL DEFAULT 'internal',
    "content" TEXT,
    "metadata" JSONB,
    "external_id" TEXT,
    "employee_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "webhook_secret" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "communications_tenant_id_client_id_idx" ON "communications"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "communications_external_id_idx" ON "communications"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_configs_tenant_id_provider_key" ON "integration_configs"("tenant_id", "provider");

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_configs" ADD CONSTRAINT "integration_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
