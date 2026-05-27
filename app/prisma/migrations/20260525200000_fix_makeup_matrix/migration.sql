-- C7 hotfix: системная строка "makeup" (Отработка) в матрице должна быть
-- только маркером для bulk-логики "уже отработано в другой группе".
-- Не списывает с абонемента и не платит ЗП — фактическое списание/ЗП
-- происходит при создании реальной отработки (present + isMakeup=true).
-- Иначе bulk «Отметить всех явка» вызывал двойное списание.
UPDATE "attendance_types"
SET "charges_subscription" = false,
    "pays_instructor" = false,
    "counts_as_revenue" = false,
    "part_of_forecast" = false
WHERE "code" = 'makeup' AND "is_system" = true;
