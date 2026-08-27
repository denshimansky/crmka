import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

/** Список суточных крон-джоб, которые сторож (/api/cron/self-check) обязан видеть
 *  отработавшими каждый день. jobName == последний сегмент пути /api/cron/<name>.
 *  billing-check-payments сюда НЕ входит — он внутридневной (каждые 2ч), его
 *  «пропуск одного слота» не критичен и проверяется отдельным, мягким правилом. */
export const DAILY_CRON_JOBS = [
  "generate-tasks",
  "promote-direction-prices",
  "close-finished-calendar-subscriptions",
  "finalize-scheduled-withdrawals",
  "check-inactive-clients",
  "close-expired-packages",
  "close-unpaid-subscriptions",
  "billing-generate-invoices",
  "notify-expiring-packages",
  "billing-block-overdue",
] as const

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/**
 * Пульс крон-задачи: апсертит строку CronHeartbeat. Сторож по last_success_at
 * понимает, отработала ли джоба сегодня. Ошибка записи пульса не должна ронять
 * саму джобу — только логируем.
 */
export async function recordCronRun(
  jobName: string,
  status: "ok" | "error",
  detail?: unknown,
): Promise<void> {
  const now = new Date()
  const detailStr =
    detail === undefined || detail === null
      ? null
      : (typeof detail === "string" ? detail : safeJson(detail)).slice(0, 1000)
  try {
    await db.cronHeartbeat.upsert({
      where: { jobName },
      create: {
        jobName,
        lastRunAt: now,
        lastSuccessAt: status === "ok" ? now : null,
        lastStatus: status,
        lastDetail: detailStr,
      },
      update: {
        lastRunAt: now,
        lastStatus: status,
        lastDetail: detailStr,
        ...(status === "ok" ? { lastSuccessAt: now } : {}),
      },
    })
  } catch (err) {
    console.error(`[cron-heartbeat] ${jobName}:`, err)
  }
}

/**
 * Единая обёртка крон-эндпоинта: проверяет Bearer CRON_SECRET, выполняет work(),
 * пишет пульс (ok/error) и возвращает NextResponse.
 *
 * Формат ответа сохраняем как раньше: тело work() разворачивается в JSON — если в
 * нём уже есть поле `ok`, отдаём как есть, иначе добавляем `ok:true`. Любой брошенный
 * из work() эксепшн → пульс "error" + HTTP 500 (раньше падало необработанным 500;
 * теперь ещё и фиксируется в пульсе, чтобы сторож перезапустил джобу).
 *
 * Пульс пишется ТОЛЬКО после успешной авторизации — 401/500-конфиг не засчитываются.
 */
export async function runCron(
  jobName: string,
  req: NextRequest,
  work: () => Promise<object | void>,
): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET не сконфигурирован" }, { status: 500 })
  }
  const auth = req.headers.get("authorization") || ""
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result: object = (await work()) ?? {}
    await recordCronRun(jobName, "ok", result)
    const body = "ok" in result ? result : { ok: true, ...result }
    return NextResponse.json(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await recordCronRun(jobName, "error", message)
    console.error(`[cron ${jobName}]`, err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
