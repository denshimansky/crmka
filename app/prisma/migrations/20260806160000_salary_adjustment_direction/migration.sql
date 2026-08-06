-- Привязка премии/депремирования к направлению (тип ЗП оклад/сделка).
-- directionId != null → сдельная (вкладка «Сделка», конкретное направление, для ОПИУ);
-- null → окладная (вкладка «Оклады»). Историческим строкам остаётся NULL.
ALTER TABLE "salary_adjustments" ADD COLUMN "direction_id" UUID;

ALTER TABLE "salary_adjustments"
  ADD CONSTRAINT "salary_adjustments_direction_id_fkey"
  FOREIGN KEY ("direction_id") REFERENCES "directions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Сдельная премия задаётся направлением вместо обязательного комментария —
-- снимаем NOT NULL с comment (комментарий теперь опционален).
ALTER TABLE "salary_adjustments" ALTER COLUMN "comment" DROP NOT NULL;
