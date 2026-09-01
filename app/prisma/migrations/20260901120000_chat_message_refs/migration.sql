-- Отпечаток чата: какие идентификаторы сообщений в нём видели.
--
-- Нужно для WhatsApp: там разметка не выводит идентификатор чата вообще (ни
-- JID, ни номера), и опознать диалог можно только косвенно — по сообщениям,
-- которые в нём лежат. Идентификатор сообщения уникален и не меняется, поэтому
-- примета «чат, где встречается сообщение X» переживает и переименование
-- контакта, и совпадение имён двух клиентов.
--
-- Миграция строго аддитивная: только новая таблица, ничего существующего не
-- трогает (см. docs/messenger-extension.md §9 — работа идёт с двух машин).

CREATE TABLE "chat_message_refs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "message_id" TEXT NOT NULL,
    "chat_key" TEXT NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_refs_pkey" PRIMARY KEY ("id")
);

-- Одно сообщение принадлежит ровно одному чату — уникальность и есть суть
-- приметы. Повторное наблюдение только двигает seen_at.
CREATE UNIQUE INDEX "chat_message_refs_tenant_id_channel_message_id_key"
    ON "chat_message_refs"("tenant_id", "channel", "message_id");

CREATE INDEX "chat_message_refs_tenant_id_channel_chat_key_idx"
    ON "chat_message_refs"("tenant_id", "channel", "chat_key");

ALTER TABLE "chat_message_refs"
    ADD CONSTRAINT "chat_message_refs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
