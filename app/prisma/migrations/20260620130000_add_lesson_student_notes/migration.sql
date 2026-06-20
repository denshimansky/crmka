-- Свободный комментарий оператора к (занятие, ученик): работает на обеих вкладках
-- реестра «Пропуски», в т.ч. «Неотмеченные», где отметки Attendance ещё нет.
-- Развязан от Attendance: переживает отметку/снятие/удаление, не влияет на деньги/ЗП/визиты.

CREATE TABLE "lesson_student_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "ward_id" UUID,
    "comment" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lesson_student_notes_pkey" PRIMARY KEY ("id")
);

-- Композитная уникальность. Для ward_id IS NULL Postgres НЕ обеспечивает
-- уникальность (NULL != NULL) — защита от дублей делается find-then-write
-- в транзакции в эндпоинте.
CREATE UNIQUE INDEX "lesson_student_notes_tenant_id_lesson_id_client_id_ward_id_key"
    ON "lesson_student_notes"("tenant_id", "lesson_id", "client_id", "ward_id");
CREATE INDEX "lesson_student_notes_tenant_id_lesson_id_idx"
    ON "lesson_student_notes"("tenant_id", "lesson_id");

-- Внешние ключи. lesson_id/client_id — ON DELETE CASCADE: занятия с нулём
-- реальных отметок (как раз строки вкладки «Неотмеченные») удаляются «жёстко»
-- (api/lessons/[id] DELETE, регенерация расписания); заметка — подчинённые
-- метаданные и удаляется вместе с занятием/клиентом.
ALTER TABLE "lesson_student_notes" ADD CONSTRAINT "lesson_student_notes_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_student_notes" ADD CONSTRAINT "lesson_student_notes_lesson_id_fkey"
    FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_student_notes" ADD CONSTRAINT "lesson_student_notes_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_student_notes" ADD CONSTRAINT "lesson_student_notes_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (как все tenant-scoped таблицы, см. 20260408120000_rls_tenant_isolation).
-- Prisma не генерирует RLS — добавляем вручную, иначе изоляция отсутствует.
ALTER TABLE "lesson_student_notes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "lesson_student_notes"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "lesson_student_notes"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- Грант app_user (ALTER DEFAULT PRIVILEGES уже покрывает новые таблицы; дублируем явно).
GRANT ALL ON TABLE "lesson_student_notes" TO app_user;
