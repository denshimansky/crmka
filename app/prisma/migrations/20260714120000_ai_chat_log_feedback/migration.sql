-- Оценка ответа AI-ассистента пользователем: like / dislike / NULL (без оценки).
-- Дизлайки — сырьё для разбора качества ответов и пополнения FAQ (ai-context.ts).

ALTER TABLE "ai_chat_logs" ADD COLUMN "feedback" TEXT;
