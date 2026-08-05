-- Баг #105: флаг «Не учитывать в ОПИУ» на приходе (прочем доходе).
-- Приход не попадёт в финрез (P&L), но останется в кассе/ДДС.
ALTER TABLE "payments" ADD COLUMN "not_in_pnl" BOOLEAN NOT NULL DEFAULT false;
