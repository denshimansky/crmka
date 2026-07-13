-- Сетка цен по количеству филиалов: {"1": 5000, "2": 9000, ...} — итоговая цена в месяц за N филиалов.
-- NULL — линейное ценообразование pricePerBranch × branchCount.
ALTER TABLE "billing_plans" ADD COLUMN "price_tiers" JSONB;

-- Тариф «Стандарт»: объёмная сетка вместо линейной цены за филиал
UPDATE "billing_plans"
SET "price_tiers" = '{"1": 5000, "2": 9000, "3": 12500, "4": 15000, "5": 17000}'::jsonb,
    "description" = 'Сетка: 1 фил. — 5 000, 2 — 9 000, 3 — 12 500, 4 — 15 000, 5 — 17 000 ₽/мес'
WHERE "name" = 'Стандарт';

-- Пересчёт хранимой месячной суммы подписок по сетке (точное попадание в ступень):
-- ранее суммы считались линейно (2 фил. = 10 000 вместо 9 000 по сетке)
UPDATE "billing_subscriptions" bs
SET "monthly_amount" = ("bp"."price_tiers" ->> bs."branch_count"::text)::numeric
FROM "billing_plans" bp
WHERE bs."plan_id" = bp."id"
  AND bp."price_tiers" IS NOT NULL
  AND bp."price_tiers" ? bs."branch_count"::text
  AND bs."status" <> 'cancelled';
