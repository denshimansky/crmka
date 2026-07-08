-- Лог диалогов AI-ассистента (/api/ai/chat): вопрос/ответ + провайдер/модель.
-- Сырьё для аудита качества ответов и пополнения FAQ базы знаний (ai-context.ts).

CREATE TABLE "ai_chat_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_name" TEXT,
    "user_role" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "reply" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_chat_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_chat_logs_tenant_id_created_at_idx" ON "ai_chat_logs"("tenant_id", "created_at");

ALTER TABLE "ai_chat_logs" ADD CONSTRAINT "ai_chat_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
