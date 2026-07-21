-- База знаний (общая продуктовая справка по CRMka).
-- ВАЖНО: контент ЕДИНЫЙ для всех организаций — таблицы БЕЗ tenant_id и БЕЗ RLS
-- (в отличие от остальных tenant-scoped таблиц). Редактирует команда через /admin,
-- читают все пользователи всех организаций.

-- CreateEnum
CREATE TYPE "KbBlockType" AS ENUM ('heading', 'text', 'image', 'video');

-- CreateTable
CREATE TABLE "kb_sections" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "kb_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_articles" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "kb_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_blocks" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "type" "KbBlockType" NOT NULL,
    "text" TEXT,
    "level" INTEGER,
    "media_url" TEXT,
    "caption" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kb_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_assets" (
    "id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kb_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kb_sections_parent_id_idx" ON "kb_sections"("parent_id");

-- CreateIndex
CREATE INDEX "kb_articles_section_id_idx" ON "kb_articles"("section_id");

-- CreateIndex
CREATE INDEX "kb_blocks_article_id_idx" ON "kb_blocks"("article_id");

-- AddForeignKey
ALTER TABLE "kb_sections" ADD CONSTRAINT "kb_sections_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "kb_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "kb_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_blocks" ADD CONSTRAINT "kb_blocks_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "kb_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Грант app_user. RLS НЕ включаем — таблицы глобальные (контент общий для всех
-- организаций). ALTER DEFAULT PRIVILEGES из 20260408120000 уже покрывает новые
-- таблицы, дублируем явно для наглядности.
GRANT ALL ON TABLE "kb_sections" TO app_user;
GRANT ALL ON TABLE "kb_articles" TO app_user;
GRANT ALL ON TABLE "kb_blocks" TO app_user;
GRANT ALL ON TABLE "kb_assets" TO app_user;
