-- Пер-организационный доступ роли к СИСТЕМНЫМ видам посещений (настройки центра
-- не должны влиять на других партнёров). «Доступно инструктору»/«Доступно админу»
-- у системных типов уходят в пер-орг. оверрайд; NULL = наследуется дефолт строки.
ALTER TABLE "attendance_type_withdrawal_overrides"
  ADD COLUMN "available_to_instructor" BOOLEAN,
  ADD COLUMN "available_to_admin" BOOLEAN;
