-- Чекбокс «Оплата инструктору за пробное» — поле на TrialLesson.
-- По умолчанию выключено; при создании пробного значение подставляется
-- из organization.pay_for_trial_lessons в API.

ALTER TABLE "trial_lessons"
  ADD COLUMN "instructor_pay_enabled" BOOLEAN NOT NULL DEFAULT FALSE;
