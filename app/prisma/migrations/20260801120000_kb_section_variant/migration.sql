-- Вкладки базы знаний: «Календарный» / «Пакетный».
-- variant на разделе (kb_sections). Верхний раздел принадлежит одной вкладке;
-- подраздел наследует variant родителя. Читалка /knowledge показывает дерево
-- той вкладки, что соответствует типу абонемента организации
-- (package → package, иначе calendar). Существующие разделы → 'calendar'
-- (DEFAULT), пакетная вкладка стартует пустой и наполняется копированием.

-- CreateEnum
CREATE TYPE "KbVariant" AS ENUM ('calendar', 'package');

-- AlterTable
ALTER TABLE "kb_sections" ADD COLUMN "variant" "KbVariant" NOT NULL DEFAULT 'calendar';

-- CreateIndex
CREATE INDEX "kb_sections_variant_idx" ON "kb_sections"("variant");
