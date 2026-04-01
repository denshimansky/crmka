-- CreateTable
CREATE TABLE IF NOT EXISTS "client_portal_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "pdn_consent" BOOLEAN NOT NULL DEFAULT false,
    "pdn_consent_date" TIMESTAMP(3),
    "last_accessed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_portal_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "client_portal_tokens_token_key" ON "client_portal_tokens"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "client_portal_tokens_token_idx" ON "client_portal_tokens"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "client_portal_tokens_tenant_id_client_id_idx" ON "client_portal_tokens"("tenant_id", "client_id");

-- AddForeignKey
ALTER TABLE "client_portal_tokens" ADD CONSTRAINT "client_portal_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
