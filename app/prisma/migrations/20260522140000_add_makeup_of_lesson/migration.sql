-- AlterTable
ALTER TABLE "attendances" ADD COLUMN "makeup_of_lesson_id" UUID;

-- CreateIndex
CREATE INDEX "attendances_tenant_id_makeup_of_lesson_id_idx" ON "attendances"("tenant_id", "makeup_of_lesson_id");

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_makeup_of_lesson_id_fkey" FOREIGN KEY ("makeup_of_lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
