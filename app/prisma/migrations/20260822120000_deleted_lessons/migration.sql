-- Архив удалённых занятий (запрос Харламовой 22.08.2026: «случайно удалили занятие,
-- нужно восстановить»). Занятие удаляется физически, и до этой миграции от него не
-- оставалось ничего: ни следа в аудите (DELETE занятия не логировался), ни способа
-- вернуть. Теперь DELETE /api/lessons/[id] кладёт сюда снимок, вкладка «Расписание»
-- карточки группы показывает такую строку как удалённую (кто и когда), а
-- «Восстановить» пересоздаёт занятие.
--
-- Почему не deleted_at на самой lessons: мягкое удаление потребовало бы фильтра в
-- ~57 местах чтения занятий (сетка, отчёты, ЗП, ЛК родителя, задачи), и единственный
-- пропуск показал бы «призрак» в расписании.
CREATE TABLE "deleted_lessons" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "instructor_id" UUID NOT NULL,
    "substitute_instructor_id" UUID,
    "is_trial" BOOLEAN NOT NULL DEFAULT false,
    "is_makeup" BOOLEAN NOT NULL DEFAULT false,
    "status" "LessonStatus" NOT NULL,
    "cancel_reason" TEXT,
    "topic" TEXT,
    "homework" TEXT,
    "rescheduled_from_date" DATE,
    "package_selections" JSONB,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_by" UUID,
    "restored_at" TIMESTAMP(3),
    "restored_by" UUID,
    "restored_lesson_id" UUID,

    CONSTRAINT "deleted_lessons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deleted_lessons_tenant_id_group_id_date_idx" ON "deleted_lessons"("tenant_id", "group_id", "date");
CREATE INDEX "deleted_lessons_tenant_id_deleted_at_idx" ON "deleted_lessons"("tenant_id", "deleted_at");

ALTER TABLE "deleted_lessons" ADD CONSTRAINT "deleted_lessons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deleted_lessons" ADD CONSTRAINT "deleted_lessons_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deleted_lessons" ADD CONSTRAINT "deleted_lessons_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deleted_lessons" ADD CONSTRAINT "deleted_lessons_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deleted_lessons" ADD CONSTRAINT "deleted_lessons_restored_by_fkey" FOREIGN KEY ("restored_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
