-- Разрешение отчисления абонемента по статусу занятия + «Отработано» как видимый тип.

-- 1. Новый флаг: разрешать ли отчислять абонемент, если у ученика на занятии
--    стоит этот статус. По умолчанию — да (ничего не ломаем).
ALTER TABLE "attendance_types"
  ADD COLUMN "allow_subscription_withdrawal" BOOLEAN NOT NULL DEFAULT true;

-- 2. «Назначена отработка» — отчисление запрещено: нельзя закрыть абонемент,
--    пока назначенная отработка не проведена или не отменена (флаг залочен в UI).
UPDATE "attendance_types"
SET "allow_subscription_withdrawal" = false
WHERE "code" = 'makeup_scheduled' AND "is_system" = true;

-- 3. Системный маркер «Отработка» переименовываем в «Отработано» — теперь он
--    виден в матрице как отдельный тип дня и проставляется автоматически, когда
--    занятие отработано.
UPDATE "attendance_types"
SET "name" = 'Отработано'
WHERE "code" = 'makeup' AND "is_system" = true;

-- 4. Backfill: уже проведённые отработки. Первоначальное (пропущенное) занятие
--    со статусом «Назначена отработка», у которого есть реальная отработка
--    (Attendance.makeup_of_lesson_id = это занятие, того же ученика), переводим в
--    «Отработано». Деньги/факт не меняются: обе строки не списывают и не считаются
--    фактом (makeup исключён из «факта» в отчётах), фактическое списание висит на
--    реальной отработке (present + isMakeup). scheduled_makeup_lesson_id оставляем
--    — по нему рисуется плашка-ссылка на занятие отработки. Наличие строки-отработки
--    проверяем БЕЗ charge_amount > 0: у бесплатного абонемента отработка несёт
--    charge = 0, но всё равно проведена (makeup_of_lesson_id ставится только на «Был»).
--    Выполняем только если системная строка «Отработано» существует.
UPDATE "attendances" a
SET "attendance_type_id" = (
  SELECT id FROM "attendance_types" WHERE "code" = 'makeup' AND "tenant_id" IS NULL LIMIT 1
)
WHERE EXISTS (
    SELECT 1 FROM "attendance_types" WHERE "code" = 'makeup' AND "tenant_id" IS NULL
  )
  AND a."attendance_type_id" IN (
    SELECT id FROM "attendance_types" WHERE "code" = 'makeup_scheduled'
  )
  AND EXISTS (
    SELECT 1 FROM "attendances" r
    WHERE r."tenant_id" = a."tenant_id"
      AND r."makeup_of_lesson_id" = a."lesson_id"
      AND r."client_id" = a."client_id"
      AND (r."ward_id" = a."ward_id" OR (r."ward_id" IS NULL AND a."ward_id" IS NULL))
  );
