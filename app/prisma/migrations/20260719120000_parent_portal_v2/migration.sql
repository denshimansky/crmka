-- ЛК родителя v2: учётки (логин=телефон, пароль), журнал согласий,
-- слаг портала + 6 URL юрдокументов у организации, контакты филиалов для ЛК.

-- CreateEnum
CREATE TYPE "PortalConsentType" AS ENUM ('offer', 'privacy_policy', 'pdn_parent', 'pdn_child', 'pdn_distribution', 'marketing');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "portal_marketing_consent_url" TEXT,
ADD COLUMN     "portal_offer_url" TEXT,
ADD COLUMN     "portal_pdn_child_consent_url" TEXT,
ADD COLUMN     "portal_pdn_distribution_consent_url" TEXT,
ADD COLUMN     "portal_pdn_parent_consent_url" TEXT,
ADD COLUMN     "portal_privacy_policy_url" TEXT,
ADD COLUMN     "portal_slug" TEXT;

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "contact_max" TEXT,
ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "contact_telegram" TEXT,
ADD COLUMN     "contact_whatsapp" TEXT;

-- CreateTable
CREATE TABLE "client_portal_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "login_phone" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "password_issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" UUID,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_portal_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_consents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "type" "PortalConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "document_url" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "source" TEXT NOT NULL DEFAULT 'portal',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_portal_accounts_client_id_key" ON "client_portal_accounts"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_portal_accounts_tenant_id_login_phone_key" ON "client_portal_accounts"("tenant_id", "login_phone");

-- CreateIndex
CREATE INDEX "client_consents_tenant_id_client_id_type_created_at_idx" ON "client_consents"("tenant_id", "client_id", "type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_portal_slug_key" ON "organizations"("portal_slug");

-- AddForeignKey
ALTER TABLE "client_portal_accounts" ADD CONSTRAINT "client_portal_accounts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_consents" ADD CONSTRAINT "client_consents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: перенос старых согласий ПДн (кнопка в токен-портале) в журнал.
-- Архивная запись source='legacy_token'; гейт v2 всё равно потребует новые
-- согласия (старое давалось на встроенный текст, а не на документы по URL).
-- Дедупликация: у клиента могло быть несколько токенов — берём последнюю дату.
INSERT INTO "client_consents" ("id", "tenant_id", "client_id", "type", "granted", "document_url", "source", "created_at")
SELECT gen_random_uuid(), t."tenant_id", t."client_id", 'pdn_parent'::"PortalConsentType", true, NULL, 'legacy_token',
       COALESCE(t."pdn_consent_date", t."created_at")
FROM (
  SELECT DISTINCT ON ("client_id") "tenant_id", "client_id", "pdn_consent_date", "created_at"
  FROM "client_portal_tokens"
  WHERE "pdn_consent" = true
  ORDER BY "client_id", "pdn_consent_date" DESC NULLS LAST
) t;
