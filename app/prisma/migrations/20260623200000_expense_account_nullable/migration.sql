-- Расход без счёта (account_id NULL): списание товара со склада создаёт расход,
-- который идёт только в ОПИУ/финрез, но НЕ в ДДС (деньги не двигаются, счёт не трогается).
ALTER TABLE "expenses" ALTER COLUMN "account_id" DROP NOT NULL;
