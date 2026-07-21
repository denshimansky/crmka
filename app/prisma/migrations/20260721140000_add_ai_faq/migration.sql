-- Ручная база знаний AI-ассистента: «вопрос → факт», подмешивается в системный
-- промпт (buildFaqSlice) поверх статичного FAQ в коде. Глобальная (без tenant_id),
-- как база знаний kb_*. Пополняется по разбору диалогов ai_chat_logs, правится
-- через /admin/ai-faq без деплоя.

CREATE TABLE "ai_faq" (
    "id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'navigation',
    "keywords" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "source_log_id" UUID,
    "created_by" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_faq_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_faq_is_active_idx" ON "ai_faq"("is_active");
