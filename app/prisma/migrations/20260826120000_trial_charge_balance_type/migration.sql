-- Платное пробное: новый тип проводки баланса для списания цены пробного.
ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'trial_charge';
