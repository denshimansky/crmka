-- becameLeadAt — момент входа контакта в статус «Новый» (Лид).
--
-- Этап «Лид» воронки (CRM-13) и виджет дашборда считают контактов, СТАВШИХ лидом
-- в выбранном месяце, а не «сейчас в статусе Новый»: лид, конвертированный за месяц
-- в актив/потенциал, должен оставаться в счёте этого месяца. Для этого нужен момент
-- входа в статус, которого в схеме не было (хранился только текущий funnel_status).
--
-- Поле поддерживается триггером — проставляется на ЛЮБОМ пути записи (app, импорт
-- CSV/1С, сиды, ручной SQL), поэтому код приложения became_lead_at не трогает.

ALTER TABLE "clients" ADD COLUMN "became_lead_at" TIMESTAMP(3);

-- Триггер: при INSERT со статусом «new» → дата создания (контакт стал лидом в момент
-- появления); при UPDATE с переходом в «new» из другого статуса (возврат в воронку)
-- → текущий момент. Прямой переход НЕ в «new» поле не меняет — сохраняется дата
-- первого/последнего входа в лид.
CREATE OR REPLACE FUNCTION set_client_became_lead_at() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.funnel_status = 'new' AND NEW.became_lead_at IS NULL THEN
      NEW.became_lead_at := COALESCE(NEW.created_at, now());
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.funnel_status = 'new' AND OLD.funnel_status IS DISTINCT FROM 'new' THEN
      NEW.became_lead_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_client_became_lead_at
  BEFORE INSERT OR UPDATE ON "clients"
  FOR EACH ROW EXECUTE FUNCTION set_client_became_lead_at();

-- Бэкафилл существующих: контакт «создан как лид» → became_lead_at = created_at.
-- Для исторических данных «создан как лид» = ручной (quick-create всегда стартует
-- «Новым») ИЛИ сейчас в статусе «Новый» (импортированные как «Новый»; импорт-база
-- статична, промежуточных статусов воронки не проходит, поэтому current=new это и
-- есть imported-as-new). Идемпотентно (WHERE became_lead_at IS NULL), безопасно
-- на любой БД, включая сид/тест.
UPDATE "clients"
SET "became_lead_at" = "created_at"
WHERE "became_lead_at" IS NULL
  AND ("source" = 'manual' OR "funnel_status" = 'new');
