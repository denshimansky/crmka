-- Новый автотриггер задач: «Пакет скоро истекает». Задачу ставит крон
-- notify-expiring-packages рядом с уведомлением в колокольчик.
-- AlterEnum
ALTER TYPE "TaskAutoTrigger" ADD VALUE 'package_expiring';
