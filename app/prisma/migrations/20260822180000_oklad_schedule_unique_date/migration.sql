-- Одна дата — одна версия оклада. Проверка «дубль → 409» в API живёт вне транзакции,
-- поэтому параллельный POST или ретрай сети мог создать две версии на один день;
-- выбор версии на день (okladAmountOnDay) при равных датах недетерминирован, и оклад
-- месяца «плавал» бы между двумя суммами. Индекс частичный: мягко удалённые версии
-- (deleted_at IS NOT NULL) не мешают завести новую на ту же дату.
CREATE UNIQUE INDEX "oklad_schedules_employee_effective_from_key"
  ON "oklad_schedules"("employee_id", "effective_from")
  WHERE "deleted_at" IS NULL;
