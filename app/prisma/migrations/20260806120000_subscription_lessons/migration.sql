-- Явный выбор конкретных занятий для ПАКЕТНОГО абонемента
-- (docs/package-lesson-selection-plan.md). Аддитивная миграция: только CREATE TABLE +
-- FK + индексы + RLS. НЕ трогает существующие lessons/subscriptions/attendance —
-- уже отмеченные занятия и живые абонементы не переписываются (инвариант миграции).
-- Пустая после наката: легаси-пакеты (0 строк) ведут себя как до фичи (инвариант №1).

CREATE TABLE "subscription_lessons" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscription_lessons_pkey" PRIMARY KEY ("id")
);

-- Натуральный ключ: один урок не более одного раза в одном абонементе.
-- Префикс subscription_id обслуживает выборку «набор выбранных занятий пакета».
CREATE UNIQUE INDEX "subscription_lessons_subscription_id_lesson_id_key"
    ON "subscription_lessons"("subscription_id", "lesson_id");
-- По-занятийный count: вместимость занятия и счётчик заполняемости сетки.
CREATE INDEX "subscription_lessons_tenant_id_lesson_id_idx"
    ON "subscription_lessons"("tenant_id", "lesson_id");

-- Внешние ключи. lesson_id — ON DELETE CASCADE: массовая отмена дня и одиночный
-- DELETE физически удаляют Lesson без реальных отметок; строка выбора — подчинённые
-- метаданные (освобождение слота + задача перевыбора делаются В КОДЕ по снапшоту ДО
-- удаления, см. reconcile-calendar-day / api/lessons/[id] DELETE). subscription_id —
-- ON DELETE CASCADE (абонементы удаляются мягко через deleted_at, cascade почти не
-- срабатывает; резолверы и так фильтруют deleted_at IS NULL).
ALTER TABLE "subscription_lessons" ADD CONSTRAINT "subscription_lessons_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_lessons" ADD CONSTRAINT "subscription_lessons_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_lessons" ADD CONSTRAINT "subscription_lessons_lesson_id_fkey"
    FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_lessons" ADD CONSTRAINT "subscription_lessons_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (как все tenant-scoped таблицы, см. 20260408120000_rls_tenant_isolation).
ALTER TABLE "subscription_lessons" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "subscription_lessons"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY bypass_rls ON "subscription_lessons"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

GRANT ALL ON TABLE "subscription_lessons" TO app_user;
