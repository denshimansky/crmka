-- Новый тип автозадачи: перевыбрать занятие пакета после отмены выбранного занятия
-- (docs/package-lesson-selection-plan.md, фаза 6a). PostgreSQL 12+ допускает
-- ALTER TYPE ADD VALUE внутри транзакции.
ALTER TYPE "TaskAutoTrigger" ADD VALUE 'reselect_package_lesson';
