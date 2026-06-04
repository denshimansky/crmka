-- Авто-закрытие неоплаченных абонементов: настройка на уровне организации.
-- Если null — функционал выключен.
ALTER TABLE "organizations" ADD COLUMN "unpaid_subscription_auto_close_days" INTEGER;
