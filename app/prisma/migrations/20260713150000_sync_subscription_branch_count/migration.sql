-- Синхронизация branch_count подписок с фактическим числом активных филиалов
-- организации (исторически у всех подписок стоял 1, филиалы не учитывались)
-- и пересчёт месячной цены: точная ступень сетки, для тарифов без сетки — линейно.
-- Организация без филиалов платит как за один.
UPDATE "billing_subscriptions" bs
SET "branch_count" = a.cnt,
    "monthly_amount" = CASE
      WHEN bp."price_tiers" IS NOT NULL AND bp."price_tiers" ? a.cnt::text
        THEN (bp."price_tiers" ->> a.cnt::text)::numeric
      WHEN bp."price_tiers" IS NULL
        THEN bp."price_per_branch" * a.cnt
      -- сетка есть, но точной ступени нет (например >5 филиалов) — оставить,
      -- пересчитает автосинхронизация при следующем изменении филиалов
      ELSE bs."monthly_amount"
    END
FROM (
  SELECT o."id" AS org_id, GREATEST(1, COUNT(b."id"))::int AS cnt
  FROM "organizations" o
  LEFT JOIN "branches" b ON b."tenant_id" = o."id" AND b."deleted_at" IS NULL
  GROUP BY o."id"
) a,
"billing_plans" bp
WHERE bs."organization_id" = a.org_id
  AND bp."id" = bs."plan_id"
  AND bs."status" <> 'cancelled'
  AND bs."branch_count" <> a.cnt;
