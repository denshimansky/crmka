-- Бонусы админов: переход от модели «строка = бонус конкретного сотрудника
-- + тип» к scope-модели «глобальные ставки + переопределения по филиалу/
-- сотруднику». Делаем employee_id и amount nullable, чтобы можно было
-- хранить глобальные (NULL,NULL) и branch-only (X,NULL) переопределения с
-- amount=NULL = «использовать default».

ALTER TABLE "admin_bonus_settings" ALTER COLUMN "employee_id" DROP NOT NULL;
ALTER TABLE "admin_bonus_settings" ALTER COLUMN "amount" DROP NOT NULL;
