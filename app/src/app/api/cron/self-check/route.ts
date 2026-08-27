import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { runCron, DAILY_CRON_JOBS } from "@/lib/cron/heartbeat"
import { sendMail } from "@/lib/mailer"

export const runtime = "nodejs"
export const maxDuration = 300

// POST /api/cron/self-check
//
// Сторож крон-задач. Запускается раз в сутки ПОСЛЕ утреннего батча (01:00 UTC =
// 04:00 МСК). Для каждой суточной джобы (DAILY_CRON_JOBS) сверяет last_success_at
// с «сегодня» (UTC). У кого успеха за сегодня нет:
//   1) ПЕРЕЗАПУСКАЕТ джобу (POST на её эндпоинт, до 2 попыток) — джобы идемпотентны;
//   2) если и перезапуск не помог — копит в список для письма.
// Список непустой → ОДНО письмо на CRON_ALERT_EMAIL.
//
// Важно (осознанный зазор): сторож живёт в самом приложении. Если лежит весь
// контейнер/сервер/БД — сторож не запустится и письма не будет. Это ловит только
// внешний dead-man's-switch (пока не заведён).
//
// Авторизация: header Authorization: Bearer ${CRON_SECRET}.

const INTERNAL_BASE_URL = process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`
const ALERT_EMAIL = process.env.CRON_ALERT_EMAIL || "fesha.lucky@gmail.com"
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 3000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Перезапуск одной джобы: POST на её эндпоинт с тем же Bearer. Успех = HTTP 2xx и
 *  тело без `ok:false`. До MAX_RETRIES попыток с паузой. */
async function retryJob(job: string, secret: string): Promise<{ ok: boolean; detail: string }> {
  let lastDetail = "не запускалась"
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${INTERNAL_BASE_URL}/api/cron/${job}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean }
      if (res.ok && body.ok !== false) {
        return { ok: true, detail: `попытка ${attempt}: успех` }
      }
      lastDetail = `попытка ${attempt}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`
    } catch (e) {
      lastDetail = `попытка ${attempt}: ${(e as Error).message}`
    }
    if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS)
  }
  return { ok: false, detail: lastDetail }
}

export async function POST(req: NextRequest) {
  return runCron("self-check", req, async () => {
    const secret = process.env.CRON_SECRET as string // runCron уже проверил наличие

    const now = new Date()
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

    const beats = await db.cronHeartbeat.findMany({
      where: { jobName: { in: [...DAILY_CRON_JOBS] } },
    })
    const beatByJob = new Map(beats.map((b) => [b.jobName, b]))

    // Джобы без успеха за сегодня (нет строки / lastSuccessAt раньше сегодня / был error).
    const missed = DAILY_CRON_JOBS.filter((job) => {
      const b = beatByJob.get(job)
      return !b?.lastSuccessAt || b.lastSuccessAt < todayUtc
    })

    // Перезапускаем пропущенные последовательно (не грузим БД разом), собираем итог.
    const recovered: string[] = []
    const stillFailing: { job: string; lastSuccessAt: string | null; lastDetail: string | null; retry: string }[] = []
    for (const job of missed) {
      const b = beatByJob.get(job)
      const r = await retryJob(job, secret)
      if (r.ok) {
        recovered.push(job)
      } else {
        stillFailing.push({
          job,
          lastSuccessAt: b?.lastSuccessAt ? b.lastSuccessAt.toISOString() : null,
          lastDetail: b?.lastDetail ?? null,
          retry: r.detail,
        })
      }
    }

    let alertSent = false
    if (stillFailing.length > 0) {
      const rows = stillFailing
        .map(
          (f) =>
            `<tr><td style="padding:4px 10px;border:1px solid #ddd">${f.job}</td>` +
            `<td style="padding:4px 10px;border:1px solid #ddd">${f.lastSuccessAt ?? "никогда"}</td>` +
            `<td style="padding:4px 10px;border:1px solid #ddd">${f.retry}</td>` +
            `<td style="padding:4px 10px;border:1px solid #ddd">${f.lastDetail ?? "—"}</td></tr>`,
        )
        .join("")
      const html =
        `<p>Сторож крон-задач (self-check) обнаружил джобы, которые не отработали сегодня ` +
        `и не поднялись после перезапуска (${MAX_RETRIES} попытки).</p>` +
        `<table style="border-collapse:collapse;font-size:14px">` +
        `<tr><th style="padding:4px 10px;border:1px solid #ddd">Джоба</th>` +
        `<th style="padding:4px 10px;border:1px solid #ddd">Последний успех</th>` +
        `<th style="padding:4px 10px;border:1px solid #ddd">Перезапуск</th>` +
        `<th style="padding:4px 10px;border:1px solid #ddd">Последняя ошибка</th></tr>` +
        `${rows}</table>` +
        `${recovered.length ? `<p>Восстановлены перезапуском: ${recovered.join(", ")}.</p>` : ""}` +
        `<p style="color:#888">Время проверки: ${now.toISOString()} (UTC).</p>`
      const text =
        `Не отработали сегодня и не поднялись после перезапуска:\n` +
        stillFailing.map((f) => `- ${f.job} (последний успех: ${f.lastSuccessAt ?? "никогда"}; перезапуск: ${f.retry})`).join("\n") +
        (recovered.length ? `\n\nВосстановлены перезапуском: ${recovered.join(", ")}` : "")
      alertSent = await sendMail({
        to: ALERT_EMAIL,
        subject: `[CRMka] Кроны не отработали: ${stillFailing.map((f) => f.job).join(", ")}`,
        html,
        text,
      })
    }

    return {
      checkedAt: now.toISOString(),
      dailyJobs: DAILY_CRON_JOBS.length,
      missed: missed.length,
      recovered,
      stillFailing: stillFailing.map((f) => f.job),
      alertSent,
    }
  })
}
