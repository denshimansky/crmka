import { db } from "@/lib/db"

// Разбор и выгрузка диалогов AI-ассистента (ai_chat_logs) для /admin/ai-review.
// Один источник запроса/форматирования — переиспользуется превью (JSON) и
// экспортом (Markdown-файл, который приносят на разбор в чат).

export interface DialogRow {
  id: string
  org: string
  userName: string | null
  userRole: string | null
  provider: string
  model: string
  message: string
  reply: string
  feedback: string | null
  createdAt: Date
}

export interface DialogRange {
  from: Date
  to: Date
  onlyDisliked: boolean
}

// Жёсткий кап выборки экспорта (защита от гигантских файлов).
export const AI_REVIEW_MAX = 1000
// Кап превью на экране (полная статистика периода считается отдельно).
export const AI_REVIEW_PREVIEW = 300

// Период из query: from/to — YYYY-MM-DD включительно. По умолчанию — 7 дней.
export function parseDialogRange(searchParams: URLSearchParams): DialogRange {
  const now = new Date()
  const toRaw = searchParams.get("to")
  const fromRaw = searchParams.get("from")

  const to = toRaw ? new Date(toRaw + "T23:59:59.999") : now
  const from = fromRaw
    ? new Date(fromRaw + "T00:00:00.000")
    : new Date(to.getTime() - 6 * 24 * 3600 * 1000)
  if (!fromRaw) from.setHours(0, 0, 0, 0)

  return { from, to, onlyDisliked: searchParams.get("onlyDisliked") === "1" }
}

export async function fetchDialogs(range: DialogRange, take = AI_REVIEW_MAX): Promise<DialogRow[]> {
  const rows = await db.aiChatLog.findMany({
    where: {
      createdAt: { gte: range.from, lte: range.to },
      ...(range.onlyDisliked ? { feedback: "dislike" } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true, userName: true, userRole: true, provider: true, model: true,
      message: true, reply: true, feedback: true, createdAt: true,
      organization: { select: { name: true } },
    },
  })
  return rows.map(r => ({
    id: r.id,
    org: r.organization?.name || "—",
    userName: r.userName,
    userRole: r.userRole,
    provider: r.provider,
    model: r.model,
    message: r.message,
    reply: r.reply,
    feedback: r.feedback,
    createdAt: r.createdAt,
  }))
}

// Статистика по всему периоду (без капа) — для сводки на странице.
export async function dialogStats(range: DialogRange) {
  const where = { createdAt: { gte: range.from, lte: range.to } }
  const [total, likes, dislikes] = await Promise.all([
    db.aiChatLog.count({ where }),
    db.aiChatLog.count({ where: { ...where, feedback: "like" } }),
    db.aiChatLog.count({ where: { ...where, feedback: "dislike" } }),
  ])
  return { total, likes, dislikes }
}

const fmtRole = (r: string | null) =>
  r === "owner" ? "владелец" : r === "manager" ? "управляющий" : r || "—"

const fmtDateTime = (d: Date) =>
  d.toLocaleString("ru-RU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })

const fmtFeedback = (f: string | null) =>
  f === "like" ? "👍 полезно" : f === "dislike" ? "👎 не помогло" : "— без оценки"

// Markdown-выгрузка диалогов за период — файл на разбор в чат. Дизлайки помечены,
// чтобы при разборе было проще расставить приоритеты.
export function buildDialogsMarkdown(dialogs: DialogRow[], range: DialogRange): string {
  const dstr = (d: Date) => d.toLocaleDateString("ru-RU")
  const likes = dialogs.filter(d => d.feedback === "like").length
  const dislikes = dialogs.filter(d => d.feedback === "dislike").length

  const head = [
    `# Диалоги ИИ-помощника`,
    ``,
    `Период: ${dstr(range.from)} — ${dstr(range.to)}${range.onlyDisliked ? " · только 👎" : ""}`,
    `Всего в выгрузке: ${dialogs.length} · 👍 ${likes} · 👎 ${dislikes}`,
    ``,
    `Задача разбора: по каждому диалогу оценить, верно ли ответил ассистент или сгаллюцинировал.`,
    `Категории ошибок: навигация (где/как) · логика и правила · данные (не подтянулись в контекст).`,
    `Итог разбора — короткие факты для базы знаний ИИ (раздел «ИИ: база знаний» в бэк-офисе).`,
    ``,
    `---`,
    ``,
  ].join("\n")

  const body = dialogs.map((d, i) => [
    `## ${i + 1}. ${d.org} · ${fmtRole(d.userRole)} · ${fmtDateTime(d.createdAt)} · ${fmtFeedback(d.feedback)}`,
    ``,
    `**Вопрос:** ${d.message}`,
    ``,
    `**Ответ ИИ:** ${d.reply}`,
    ``,
    `---`,
    ``,
  ].join("\n")).join("\n")

  return head + body
}
