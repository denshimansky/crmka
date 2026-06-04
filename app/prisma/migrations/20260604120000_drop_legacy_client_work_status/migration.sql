-- Убираем из ClientWorkStatus legacy-значения upsell/returning.
-- В коде они нигде не выставляются, но чистим возможные исторические записи.
UPDATE "clients" SET "client_status" = NULL
WHERE "client_status" IN ('upsell', 'returning');

ALTER TYPE "ClientWorkStatus" RENAME TO "ClientWorkStatus_old";

CREATE TYPE "ClientWorkStatus" AS ENUM ('active', 'churned', 'archived');

ALTER TABLE "clients"
  ALTER COLUMN "client_status" TYPE "ClientWorkStatus"
  USING ("client_status"::text::"ClientWorkStatus");

DROP TYPE "ClientWorkStatus_old";
