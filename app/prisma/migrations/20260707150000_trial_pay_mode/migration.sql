-- Оплата пробных занятий педагогу: булева настройка pay_for_trial_lessons
-- заменяется трёхзначным режимом trial_pay_mode:
--   none      — не платить за пробные (прежнее false)
--   paid_only — платить только за платные пробные (у направления задана цена
--               пробного; прежнее true)
--   all       — платить за все пробные, включая бесплатные
-- Режим задаёт ДЕФОЛТ флага instructor_pay_enabled у создаваемых пробных;
-- на конкретном пробном флаг по-прежнему переключается вручную (карточка занятия).

ALTER TABLE "organizations" ADD COLUMN "trial_pay_mode" TEXT NOT NULL DEFAULT 'none';
UPDATE "organizations" SET "trial_pay_mode" = 'paid_only' WHERE "pay_for_trial_lessons" = true;
ALTER TABLE "organizations" DROP COLUMN "pay_for_trial_lessons";
