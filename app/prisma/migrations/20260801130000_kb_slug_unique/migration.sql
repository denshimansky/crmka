-- Целостность слагов базы знаний. До сих пор уникальность обеспечивалась только
-- проверкой в приложении (uniqueSectionSlug/uniqueArticleSlug — check-then-insert),
-- что оставляло TOCTOU-гонку: два редактора одновременно вычисляли один и тот же
-- свободный слаг и оба вставляли строку → дубль. Читалка резолвит раздел/статью
-- по слагу (findFirst), поэтому «проигравший» становился недоступен по URL.
--
-- Добавляем БД-гарантию частичным UNIQUE (WHERE deleted_at IS NULL), чтобы
-- soft-deleted строки не мешали переиспользованию слага. Приложение ловит P2002
-- и ретраит подбор слага (withSlugRetry в lib/kb.ts). Партиал-UNIQUE через raw SQL —
-- как organizations_inn_unique (Prisma-схема партиал-индексы не выражает).
--
-- Прод (msk1) проверен 01.08.2026: активных дублей нет (0 разделов, 0 статей).

CREATE UNIQUE INDEX "kb_sections_slug_active_key" ON "kb_sections" ("slug") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "kb_articles_section_slug_active_key" ON "kb_articles" ("section_id", "slug") WHERE "deleted_at" IS NULL;
