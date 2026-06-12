-- Чекбокс «Подтвердили пробное» на вкладке «Пробное» в «Продажах»:
-- родитель подтвердил по телефону/в мессенджере, что придут на пробное.
ALTER TABLE "trial_lessons" ADD COLUMN "confirmed" BOOLEAN NOT NULL DEFAULT false;
