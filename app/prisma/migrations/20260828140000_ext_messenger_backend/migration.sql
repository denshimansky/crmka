-- Бэкенд браузерного расширения-панели над мессенджерами (аналог BubbleXT).
-- См. docs/messenger-extension.md. Миграция строго аддитивная: новые значения
-- enum, nullable-колонка и три новые таблицы — накат на прод безвреден до того,
-- как появится сам код расширения.

-- 1. Универсальные типы сообщений мессенджеров. Конкретный мессенджер несёт
--    channel, поэтому *_incoming/*_outgoing на каждый канал не плодим.
--    Легаси whatsapp_incoming/whatsapp_outgoing остаются (их пишет вебхук Wazzup).
ALTER TYPE "CommunicationType" ADD VALUE IF NOT EXISTS 'messenger_incoming';
ALTER TYPE "CommunicationType" ADD VALUE IF NOT EXISTS 'messenger_outgoing';

-- 2. Недостающие каналы: ВК и MAX (whatsapp/telegram в enum уже были).
ALTER TYPE "CommunicationChannel" ADD VALUE IF NOT EXISTS 'vk';
ALTER TYPE "CommunicationChannel" ADD VALUE IF NOT EXISTS 'max';

-- 3. Реальное время сообщения в мессенджере. created_at — момент записи в нашу
--    БД: при заливке задним числом порядок в ленте ломается. Ленты сортируем по
--    COALESCE(sent_at, created_at) DESC. NULL — у всего, что рождается в CRM.
ALTER TABLE "communications" ADD COLUMN "sent_at" TIMESTAMP(3);

-- 4. Ключ идемпотентности заливки сообщений: расширение при каждом открытии
--    чата видит те же последние сообщения и переливает их повторно. В PostgreSQL
--    NULL-значения в UNIQUE не конфликтуют, поэтому внутренние заметки
--    (external_id IS NULL) не мешают. Проверено на проде 28.08.2026: строк с
--    непустым external_id нет вовсе, конфликтов при создании индекса не будет.
CREATE UNIQUE INDEX "communications_tenant_id_channel_external_id_key"
  ON "communications" ("tenant_id", "channel", "external_id");

-- 5. Привязка чата в мессенджере к клиенту CRM — ядро идентификации расширения.
--    Матч по телефону честно работает только в WhatsApp (и то LID/username его
--    размывают); в Telegram/VK/MAX телефона нет вовсе, поэтому связку создаёт
--    сотрудник (с автоподсказкой) один раз, дальше она переиспользуется.
CREATE TABLE "chat_bindings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "external_chat_id" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "ward_id" UUID,
    "display_name" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "chat_bindings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_bindings_tenant_id_channel_external_chat_id_key"
  ON "chat_bindings" ("tenant_id", "channel", "external_chat_id");
CREATE INDEX "chat_bindings_tenant_id_client_id_idx"
  ON "chat_bindings" ("tenant_id", "client_id");

ALTER TABLE "chat_bindings" ADD CONSTRAINT "chat_bindings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_bindings" ADD CONSTRAINT "chat_bindings_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_bindings" ADD CONSTRAINT "chat_bindings_ward_id_fkey"
  FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_bindings" ADD CONSTRAINT "chat_bindings_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Шаблоны ответов: готовый текст с плейсхолдерами, который сотрудник
--    вставляет в поле ввода мессенджера. Автоотправки нет — отправляет человек.
CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" "CommunicationChannel",
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "message_templates_tenant_id_deleted_at_idx"
  ON "message_templates" ("tenant_id", "deleted_at");

ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. Персональный токен доступа сотрудника (PAT) для расширения. next-auth
--    держит сессию в httpOnly-cookie домена CRMka — страница мессенджера её не
--    отправит, поэтому нужна отдельная поверхность авторизации (образец —
--    portal-auth ЛК родителя). В БД только sha256-хеш: сам секрет показывается
--    один раз при выпуске. sha256, а не bcrypt — секрет высокоэнтропийный, а
--    проверка должна быть дешёвой и делаться одним lookup по уникальному хешу.
CREATE TABLE "api_tokens" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens" ("token_hash");
CREATE INDEX "api_tokens_tenant_id_employee_id_idx"
  ON "api_tokens" ("tenant_id", "employee_id");

ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
