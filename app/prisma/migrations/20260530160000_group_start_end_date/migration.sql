-- Группы: дата старта и окончания.
-- start_date может быть в будущем (группа стартует позже), end_date — пустое = бессрочная.
ALTER TABLE "groups"
  ADD COLUMN "start_date" TIMESTAMP(3),
  ADD COLUMN "end_date"   TIMESTAMP(3);
