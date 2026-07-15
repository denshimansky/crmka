-- Один владелец (ИНН) может иметь несколько организаций — подтверждённый
-- бизнес-кейс: у Премеленной два тенанта (ДЦ Замок и ДЮЦ Чарівний замок)
-- на один ИНН 900400092547, каждый биллится отдельным счётом (матчинг
-- оплат по выписке спроектирован под это: правила inn_pair / inn_total).
--
-- Уникальный индекс появился в 20260408120000_rls_tenant_isolation как
-- гигиенический guard (в Prisma-схеме не отражён, код на него не завязан).
-- Снимаем уникальность, обычный индекс оставляем — по нему ищет матчинг
-- оплат (organizations WHERE inn = payerInn).

DROP INDEX IF EXISTS "organizations_inn_unique";
CREATE INDEX IF NOT EXISTS "organizations_inn_idx" ON "organizations" ("inn") WHERE "inn" IS NOT NULL;
