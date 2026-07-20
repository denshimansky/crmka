// Получение официального наименования заказчика по ИНН через API checko.ru.
// Нужно, чтобы в «Счёт-договоре оферты» (invoice-pdf.ts) в графе «Заказчик»
// стояло реальное юрлицо/ИП из ЕГРЮЛ/ЕГРИП, а не название детского центра
// из системы (organization.name).
//
// checko различает два справочника по длине ИНН:
//   /v2/company      — юрлица (ЮЛ, ИНН 10 знаков):  data.НаимПолн / data.НаимСокр
//   /v2/entrepreneur — ИП/физлица (ИНН 12 знаков): data.ФИО (+ data.Тип)
// «Не найдено» приходит как meta.status="ok" с пустым data:{} — трактуем как null.
//
// Ключ — env CHECKO_API_KEY. Без ключа или при любой ошибке возвращаем null:
// счёт отрендерится с прежним фоллбэком на organization.name, ничего не падает.

const API_BASE = "https://api.checko.ru/v2"
const REQUEST_TIMEOUT_MS = 15_000
const IP_PREFIX = "Индивидуальный предприниматель"

type CheckoEndpoint = "company" | "entrepreneur"

export interface ResolvedLegalName {
  legalName: string
  kind: "ИП" | "ЮЛ"
}

interface CheckoResponse {
  data?: Record<string, unknown>
  meta?: { status?: string; message?: string }
}

// Достаём официальное наименование из ответа checko. Чистая функция —
// вынесена отдельно, чтобы юнит-тестировать без сети.
export function legalNameFromResponse(
  endpoint: CheckoEndpoint,
  data: Record<string, unknown> | undefined | null
): ResolvedLegalName | null {
  if (!data || Object.keys(data).length === 0) return null

  if (endpoint === "entrepreneur") {
    const fio = typeof data["ФИО"] === "string" ? (data["ФИО"] as string).trim() : ""
    if (!fio) return null
    const tip = typeof data["Тип"] === "string" ? (data["Тип"] as string).trim() : ""
    const prefix = tip || IP_PREFIX
    return { legalName: `${prefix} ${fio}`, kind: "ИП" }
  }

  // ЮЛ: предпочитаем полное официальное наименование, иначе сокращённое
  const full = [data["НаимПолн"], data["НаимСокр"]].find(
    (v) => typeof v === "string" && (v as string).trim()
  ) as string | undefined
  if (!full) return null
  return { legalName: full.trim(), kind: "ЮЛ" }
}

async function callChecko(
  endpoint: CheckoEndpoint,
  inn: string,
  key: string
): Promise<CheckoResponse | null> {
  const url = `${API_BASE}/${endpoint}?key=${encodeURIComponent(key)}&inn=${encodeURIComponent(inn)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    return (await res.json()) as CheckoResponse
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Возвращает официальное наименование по ИНН либо null (нет ключа / не найдено /
// ошибка сети). Никогда не бросает исключение.
export async function resolveLegalNameByInn(
  inn: string | null | undefined
): Promise<ResolvedLegalName | null> {
  const key = process.env.CHECKO_API_KEY
  if (!key) return null
  const clean = (inn || "").replace(/\D/g, "")
  if (clean.length !== 10 && clean.length !== 12) return null

  // 12 знаков — ИП/физлицо, 10 — ЮЛ. Порядок эндпоинтов по длине ИНН, с фоллбэком
  // на второй справочник (на случай нетипового ИНН).
  const order: CheckoEndpoint[] =
    clean.length === 12 ? ["entrepreneur", "company"] : ["company", "entrepreneur"]

  for (const endpoint of order) {
    const json = await callChecko(endpoint, clean, key)
    const resolved = legalNameFromResponse(endpoint, json?.data)
    if (resolved) return resolved
  }
  return null
}

// Если у организации есть ИНН, но пустой legalName — подтягиваем официальное
// наименование из checko и сохраняем в organization.legalName. Best-effort:
// при неудаче организацию не трогаем. Возвращает подставленное имя либо null.
// db импортируется динамически, чтобы модуль оставался тестируемым без Prisma.
export async function ensureOrgLegalName(org: {
  id: string
  inn: string | null
  legalName: string | null
}): Promise<string | null> {
  if (org.legalName && org.legalName.trim()) return org.legalName
  if (!org.inn || !org.inn.trim()) return null

  const resolved = await resolveLegalNameByInn(org.inn)
  if (!resolved) return null

  try {
    const { db } = await import("@/lib/db")
    await db.organization.update({
      where: { id: org.id },
      data: { legalName: resolved.legalName },
    })
  } catch {
    return null
  }
  return resolved.legalName
}
