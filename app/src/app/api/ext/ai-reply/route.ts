import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { AI_DAILY_LIMIT, aiConfigured } from "@/lib/ai-provider"
import { requireExtAuth } from "@/lib/ext-auth"
import { extJson, extOptions, readExtJson } from "@/lib/ext-cors"
import { buildAiReplyDraft } from "@/lib/ext/ai-reply"

/**
 * POST /api/ext/ai-reply — черновик ответа родителю.
 *
 * Панель кладёт результат В ПОЛЕ ВВОДА мессенджера; отправляет человек. Это не
 * автоответчик (принцип-щит спеки §3), и никакой ветки «сразу отправить» здесь
 * не появится.
 *
 * Лимит общий с ИИ-ассистентом CRM: 50 обращений в сутки на организацию,
 * считаются по фактически записанным строкам ai_chat_logs. Туда же пишется и
 * черновик — один журнал на все ИИ-функции, по нему видно и расход, и качество.
 */
export const OPTIONS = extOptions

const bodySchema = z.object({
  clientId: z.string().uuid().nullish(),
  /** Видимые сообщения чата: их и так видит сотрудник на экране. */
  messages: z
    .array(
      z.object({
        direction: z.enum(["incoming", "outgoing"]),
        text: z.string().max(20000).nullish(),
      }),
    )
    .max(50)
    .optional(),
  /** Необязательная подсказка сотрудника: «попроси оплатить», «предложи перенос». */
  instruction: z.string().max(500).nullish(),
})

export async function POST(req: NextRequest) {
  const guard = await requireExtAuth(req, "ext.ai")
  if (!guard.ok) return guard.response
  const { ctx } = guard

  if (!aiConfigured()) {
    return extJson(req, { error: "ИИ не подключён. Обратитесь к администратору CRM." }, { status: 503 })
  }

  // Битое тело больше не даёт 500 без CORS-заголовков (см. readExtJson).
  const body = await readExtJson(req)
  if (body === undefined) {
    return extJson(req, { error: "Ожидался JSON в теле запроса" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return extJson(
      req,
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }

  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const usedToday = await db.aiChatLog.count({
    where: { tenantId: ctx.tenantId, createdAt: { gte: startOfDay } },
  })
  if (usedToday >= AI_DAILY_LIMIT) {
    return extJson(
      req,
      {
        error: `Дневной лимит запросов к ИИ исчерпан (${AI_DAILY_LIMIT} в сутки на организацию). Лимит обновится завтра.`,
      },
      { status: 429 },
    )
  }

  const messages = (parsed.data.messages ?? [])
    .filter((m): m is { direction: "incoming" | "outgoing"; text: string } => Boolean(m.text?.trim()))
    .map((m) => ({ direction: m.direction, text: m.text }))

  let draft
  try {
    draft = await buildAiReplyDraft(ctx, {
      clientId: parsed.data.clientId,
      messages,
      instruction: parsed.data.instruction,
    })
  } catch (error) {
    // Релей недоступен, кончилась квота провайдера — панель должна сказать это
    // человеческим языком, а не отдать 500.
    console.error("[ext/ai-reply] Provider error:", error)
    return extJson(req, { error: "ИИ сейчас недоступен. Попробуйте позже." }, { status: 503 })
  }

  if (!draft.text) {
    return extJson(req, { error: "ИИ не смог составить черновик. Попробуйте ещё раз." }, { status: 502 })
  }

  // Журнал: тот же, что у ассистента CRM. Сбой записи не должен лишать
  // сотрудника готового черновика.
  try {
    await db.aiChatLog.create({
      data: {
        tenantId: ctx.tenantId,
        userName: ctx.employeeName || "Расширение",
        userRole: ctx.role,
        provider: draft.provider,
        model: draft.model,
        message: `[черновик ответа в мессенджере] ${draft.contextSummary}`,
        reply: draft.text,
      },
    })
  } catch (logErr) {
    console.error("[ext/ai-reply] Log write error:", logErr)
  }

  return extJson(req, { text: draft.text, remaining: Math.max(0, AI_DAILY_LIMIT - usedToday - 1) })
}
