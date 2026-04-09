-- Справочник каналов привлечения
CREATE TABLE "lead_channels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_channels_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_channels_tenant_id_idx" ON "lead_channels"("tenant_id");

ALTER TABLE "lead_channels" ADD CONSTRAINT "lead_channels_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Связь Client → LeadChannel
ALTER TABLE "clients" ADD CONSTRAINT "clients_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "lead_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Справочник причин пропусков
CREATE TABLE "absence_reasons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absence_reasons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "absence_reasons_tenant_id_idx" ON "absence_reasons"("tenant_id");

ALTER TABLE "absence_reasons" ADD CONSTRAINT "absence_reasons_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Связь Attendance → AbsenceReason
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_absence_reason_id_fkey"
    FOREIGN KEY ("absence_reason_id") REFERENCES "absence_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Замена инструктора на занятии
ALTER TABLE "lessons" ADD COLUMN "substitute_instructor_id" UUID;

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_substitute_instructor_id_fkey"
    FOREIGN KEY ("substitute_instructor_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Предустановленные каналы привлечения (для каждой существующей организации)
INSERT INTO "lead_channels" ("tenant_id", "name", "is_system", "sort_order")
SELECT o.id, ch.name, true, ch.sort_order
FROM "organizations" o
CROSS JOIN (VALUES
    ('Сайт', 1),
    ('Инстаграм', 2),
    ('ВКонтакте', 3),
    ('Рекомендация', 4),
    ('Проходил мимо', 5),
    ('Яндекс.Карты', 6),
    ('2ГИС', 7),
    ('Авито', 8),
    ('Telegram', 9),
    ('WhatsApp', 10),
    ('Другое', 11)
) AS ch(name, sort_order);

-- Предустановленные причины пропусков (для каждой существующей организации)
INSERT INTO "absence_reasons" ("tenant_id", "name", "is_system", "sort_order")
SELECT o.id, ar.name, true, ar.sort_order
FROM "organizations" o
CROSS JOIN (VALUES
    ('Болезнь', 1),
    ('Отпуск/поездка', 2),
    ('Семейные обстоятельства', 3),
    ('Погода', 4),
    ('Без причины', 5),
    ('Другое', 6)
) AS ar(name, sort_order);
