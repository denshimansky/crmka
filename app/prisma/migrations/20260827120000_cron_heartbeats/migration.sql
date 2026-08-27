-- Пульс крон-задач: каждый /api/cron/* при успехе апсертит свою строку, а сторож
-- /api/cron/self-check раз в сутки сверяет last_success_at с «сегодня», перезапускает
-- пропущенные джобы и алертит на почту, если перезапуск не помог. Ops-таблица, не
-- мультитенантная (кроны обходят всех тенантов).

-- CreateTable
CREATE TABLE "cron_heartbeats" (
    "job_name" TEXT NOT NULL,
    "last_run_at" TIMESTAMP(3) NOT NULL,
    "last_success_at" TIMESTAMP(3),
    "last_status" TEXT NOT NULL,
    "last_detail" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_heartbeats_pkey" PRIMARY KEY ("job_name")
);
