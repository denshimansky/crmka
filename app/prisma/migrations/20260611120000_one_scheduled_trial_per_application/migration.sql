-- Одна заявка — одно назначенное (scheduled) пробное.

-- Шаг 1: дедупликация существующих данных. До этого правила дубли scheduled-пробных
-- по одной заявке создавались свободно (блокировались только «та же группа + дата» /
-- «та же дата + время»), а бэкофилл funnel_per_application привязал все пробные
-- ребёнка+направления к одной заявке. Оставляем самое позднее scheduled-пробное
-- (по дате, затем по времени создания), остальные отменяем.
UPDATE "trial_lessons" t
SET "status" = 'cancelled'
WHERE t."status" = 'scheduled'
  AND t."application_id" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "trial_lessons" t2
    WHERE t2."application_id" = t."application_id"
      AND t2."id" <> t."id"
      AND t2."status" = 'scheduled'
      AND (
        t2."scheduled_date" > t."scheduled_date"
        OR (t2."scheduled_date" = t."scheduled_date" AND t2."created_at" > t."created_at")
        OR (t2."scheduled_date" = t."scheduled_date" AND t2."created_at" = t."created_at" AND t2."id" > t."id")
      )
  );

-- Шаг 2: частичный уникальный индекс — инвариант на уровне БД (закрывает гонку
-- двух параллельных записей). Prisma partial unique не поддерживает — raw SQL.
-- NULL application_id (пробные без заявки) под ограничение не попадают.
CREATE UNIQUE INDEX "trial_lessons_application_scheduled_uniq"
  ON "trial_lessons"("application_id")
  WHERE "status" = 'scheduled';
