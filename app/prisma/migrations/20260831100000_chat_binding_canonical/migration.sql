-- Каноникализация идентификатора чата (docs/messenger-extension.md §8).
--
-- Один и тот же собеседник в Telegram WebK (/k) и WebA (/a) приходит под разными
-- идентификаторами: «@username» против числового peer id. Из-за этого привязка,
-- сделанная в одном клиенте, не находилась в другом, а переписка задваивалась в
-- карточке — ключ дедупа сообщения склеивается с идентификатором чата.
--
-- Теперь на одного клиента может быть НЕСКОЛЬКО строк chat_bindings (по одной на
-- идентификатор), и все они ссылаются на общий канон.
--
-- Строго аддитивно: колонка nullable, индекс новый. NULL = канон не определён,
-- поведение прежнее. Накат на прод безвреден в любой момент.
ALTER TABLE "chat_bindings" ADD COLUMN "canonical_chat_id" TEXT;

CREATE INDEX "chat_bindings_tenant_id_channel_canonical_chat_id_idx"
  ON "chat_bindings" ("tenant_id", "channel", "canonical_chat_id");
