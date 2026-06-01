-- Добавляем тип уведомления для скорого истечения пакетного абонемента.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'package_expiring';
