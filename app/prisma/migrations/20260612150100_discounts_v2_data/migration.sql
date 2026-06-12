-- Скидки v2 (docs/discounts-v2.md): миграция данных.

-- 1. Заморозка выданных скидок старой логики: абонементы с ненулевой скидкой
-- помечаются legacy — новая логика их не изменяет ни одним триггером.
UPDATE "subscriptions"
SET "discount_source" = 'legacy'
WHERE "discount_amount" <> 0 AND "deleted_at" IS NULL;

-- 2. Легаси-шаблоны: старые системные linked-шаблоны и все fixed-шаблоны
-- (старая семантика value = «цена занятия со скидкой», автоконвертация
-- невозможна) деактивируются. Permanent+percent остаются жить как тип 2.
UPDATE "discount_templates"
SET "is_legacy" = true, "is_active" = false
WHERE "kind" IN ('linked_sibling', 'linked_second_direction')
   OR "value_type" = 'fixed';

-- 3. Сброс выбора старых linked-шаблонов в карточках клиентов («Без скидки»).
UPDATE "clients" c
SET "discount_template_id" = NULL
FROM "discount_templates" t
WHERE c."discount_template_id" = t."id"
  AND t."kind" IN ('linked_sibling', 'linked_second_direction');

-- 4. Посев системного шаблона тип 1 «Скидка за второй абонемент» всем
-- организациям: ВЫКЛЮЧЕН, фикс 50 ₽ за занятие (новая семантика value).
-- Организация включает сама (activated_at проставится при включении).
INSERT INTO "discount_templates"
  ("id", "tenant_id", "name", "type", "kind", "system_key", "value_type", "value",
   "is_stackable", "is_active", "is_legacy", "created_at", "updated_at")
SELECT gen_random_uuid(), o."id", 'Скидка за второй абонемент',
       'second_subscription', 'second_subscription', 'second_subscription',
       'fixed', 50, false, false, false, NOW(), NOW()
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "discount_templates" t
  WHERE t."tenant_id" = o."id" AND t."system_key" = 'second_subscription'
);

-- 5. Уведомление владельцам организаций, у которых деактивированы
-- НЕсистемные fixed-шаблоны (их нужно перенастроить под новую семантику).
INSERT INTO "notifications"
  ("id", "tenant_id", "employee_id", "type", "title", "message",
   "entity_type", "is_read", "created_at")
SELECT gen_random_uuid(), e."tenant_id", e."id", 'linked_discount_warning',
       'Шаблоны скидок отключены — нужна перенастройка',
       'Логика скидок обновлена: для фиксированных скидок теперь указывается размер скидки за занятие (раньше — цена занятия со скидкой). Ваши фиксированные шаблоны отключены — задайте им новое значение в Настройках → Шаблоны скидок и включите снова.',
       'DiscountTemplate', false, NOW()
FROM "employees" e
WHERE e."role" = 'owner' AND e."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "discount_templates" t
    WHERE t."tenant_id" = e."tenant_id"
      AND t."is_legacy" = true AND t."value_type" = 'fixed'
      AND t."system_key" IS NULL
  );
