import { formatMoney } from "@/lib/currency"
import { lessonsWord } from "@/lib/plural"
import { collectClientFacts, formatLessonLine, type ClientFacts } from "@/lib/ext/quick-info"
import { callAi } from "@/lib/ai-provider"
import type { ExtContext } from "@/lib/ext-auth"

/**
 * ИИ-черновик ответа родителю (docs/messenger-extension.md §5, Фаза 3).
 *
 * Что это НЕ: не автоответчик. Модель пишет черновик, он попадает в поле ввода
 * мессенджера, сотрудник читает, правит и отправляет сам — принцип-щит спеки
 * (§3) действует и здесь, иначе расширение превращается в рассыльщик.
 *
 * Из чего собирается контекст: карточка клиента (те же факты, что в справке и
 * шаблонах) и последние сообщения чата, которые сотрудник видит на экране.
 * Ничего сверх этого модель не получает — ни чужих клиентов, ни финансов
 * организации.
 *
 * Главный риск здесь — выдуманные обещания: «переведём занятие на пятницу»,
 * «вернём деньги», «скидка 20%». Поэтому промпт запрещает обещать что-либо, чего
 * нет в данных, и разрешает переспросить. Ответственность всё равно на человеке,
 * который жмёт «отправить», но черновик не должен его подставлять.
 */

/** Сообщение переписки для контекста. */
export interface AiReplyMessage {
  direction: "incoming" | "outgoing"
  text: string
}

/** Сколько последних сообщений отдаём модели и сколько символов из каждого. */
const CONTEXT_MESSAGES = 10
const MAX_MESSAGE_LENGTH = 600

/**
 * Переписка в виде «кто — что». Роли называем явно: без них модель путается,
 * кому отвечать, и начинает писать от лица родителя.
 */
export function buildConversationText(messages: AiReplyMessage[]): string | null {
  const lines = messages
    .filter((m) => m.text?.trim())
    .slice(-CONTEXT_MESSAGES)
    .map((m) => {
      const who = m.direction === "outgoing" ? "Мы" : "Родитель"
      return `${who}: ${m.text.trim().slice(0, MAX_MESSAGE_LENGTH)}`
    })
  return lines.length ? lines.join("\n") : null
}

/**
 * Карточка клиента текстом — то, на что модели разрешено опираться.
 * Пишем только факты: имена, занятия, остаток, долг. Ни статусов воронки, ни
 * внутренних терминов CRM — они утекут в текст родителю.
 */
export function buildClientContext(facts: ClientFacts): string {
  const lines: string[] = []
  if (facts.parentFirstName) lines.push(`Родитель: ${facts.parentFirstName}`)

  for (const ward of facts.wards) {
    const parts: string[] = [`Ребёнок: ${ward.name}`]
    const next = ward.lessons[0]
    if (next) parts.push(`ближайшее занятие ${formatLessonLine(next)}`)
    for (const sub of ward.subscriptions) {
      const what = sub.direction ?? "занятия"
      parts.push(
        `абонемент «${what}»: осталось ${sub.remainingLessons} ${lessonsWord(sub.remainingLessons)}` +
          (sub.debt > 0 ? `, к оплате ${formatMoney(sub.debt, facts.currency)}` : ""),
      )
    }
    lines.push(parts.join("; "))
  }

  if (facts.balance < 0) {
    lines.push(`Задолженность по балансу: ${formatMoney(-facts.balance, facts.currency)}`)
  } else if (facts.balance > 0) {
    lines.push(`На балансе: ${formatMoney(facts.balance, facts.currency)}`)
  }

  if (facts.branchName) lines.push(`Филиал: ${facts.branchName}`)
  return lines.join("\n")
}

/**
 * Инструкции модели. Статическая часть — одна на все запросы, поэтому её
 * кэширует провайдер (см. lib/ai-provider.ts).
 */
export const AI_REPLY_SYSTEM = `Ты помогаешь администратору детского центра ответить родителю в мессенджере.

Ты пишешь ЧЕРНОВИК одного сообщения. Его прочитает администратор, поправит и отправит сам.

ПРАВИЛА:
- Пиши от лица центра, на «вы», вежливо и коротко: 1–3 предложения, как в живой переписке.
- Опирайся ТОЛЬКО на данные из блока «КАРТОЧКА КЛИЕНТА» и на переписку. Ничего не додумывай.
- НЕ обещай того, чего нет в данных: перенос занятия, возврат денег, скидку, звонок «через 5 минут».
- Не называй сумм, дат и имён, которых нет в данных. Не знаешь — переспроси у родителя.
- Обращайся к родителю по имени, если оно есть в карточке.
- Без markdown, без списков, без подписи и без «С уважением» — администратор подпишется сам.
- Пиши только текст сообщения, без пояснений и без кавычек вокруг него.`

export interface AiReplyResult {
  text: string
  provider: string
  model: string
  /** Что именно ушло модели помимо статичных инструкций — пишем в лог для аудита. */
  contextSummary: string
}

/**
 * Собрать черновик ответа.
 *
 * clientId может не быть (чат не привязан) — тогда контекста карточки нет, и
 * модель работает только по переписке. Это нормально: администратору как раз
 * нужен вежливый ответ незнакомому человеку.
 */
export async function buildAiReplyDraft(
  ctx: ExtContext,
  input: {
    clientId?: string | null
    messages?: AiReplyMessage[]
    instruction?: string | null
  },
): Promise<AiReplyResult> {
  const facts = input.clientId ? await collectClientFacts(ctx, input.clientId) : null
  const conversation = buildConversationText(input.messages ?? [])
  const clientContext = facts ? buildClientContext(facts) : null

  const dynamicParts = [
    clientContext ? `КАРТОЧКА КЛИЕНТА:\n${clientContext}` : "КАРТОЧКА КЛИЕНТА: нет данных",
    conversation ? `ПЕРЕПИСКА (последние сообщения):\n${conversation}` : null,
  ].filter(Boolean)

  const task = input.instruction?.trim()
    ? `Задача от администратора: ${input.instruction.trim()}`
    : "Напиши черновик ответа на последнее сообщение родителя."

  const answer = await callAi({
    systemStatic: AI_REPLY_SYSTEM,
    systemDynamic: dynamicParts.join("\n\n"),
    messages: [{ role: "user", content: task }],
    // Черновик — это пара предложений; большой лимит только оплачивает
    // многословие модели.
    maxTokens: 400,
  })

  return {
    text: answer.text,
    provider: answer.provider,
    model: answer.model,
    contextSummary: task,
  }
}
