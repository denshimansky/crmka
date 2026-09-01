import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { scopeClientByBranch } from "@/lib/client-segments"
import { requireExtAuth } from "@/lib/ext-auth"
import { extJson, extOptions, readExtJson } from "@/lib/ext-cors"
import {
  MESSENGER_CHANNELS,
  buildMessageExternalId,
  isLocalMessageId,
  isMaxGroupChatId,
  isMintedChatKey,
  isUnsupportedChat,
  messageTypeForDirection,
  normalizeChatId,
  parseMessageSentAt,
  toPrismaChannel,
  unsupportedChatMessage,
} from "@/lib/ext/chat-identity"
import { planCommunicationKeyRepair, splitChatIds } from "@/lib/ext/chat-canonical"
import { findChatKeyByMessageIds, rememberMessageIds } from "@/lib/ext/chat-message-refs"
import {
  applyCommunicationKeyRepair,
  resolveChatGroup,
} from "@/lib/ext/chat-binding-sync"

/**
 * POST /api/ext/communications/batch — заливка увиденных сообщений в единую
 * историю коммуникаций (docs/messenger-extension.md).
 *
 * Смысл фичи: родитель писал в одном мессенджере, сегодня пишет в другом —
 * администратор видит всю переписку в карточке клиента.
 *
 * Идемпотентность обязательна: панель при КАЖДОМ открытии чата видит те же
 * последние сообщения и шлёт их повторно. Ключ — (tenantId, channel, externalId),
 * уникальный индекс в БД; createMany({ skipDuplicates }) молча пропускает
 * повторы, поэтому гонка двух вкладок не создаёт дублей.
 *
 * Пишем только то, что администратор и так видит на экране (принцип-щит из
 * спеки): никакой выкачки истории, никаких вложений — только текст, направление
 * и время.
 */
export const OPTIONS = extOptions

/** Ограничение длины текста: в БД поле text, но мегабайтные простыни нам не нужны. */
const MAX_TEXT_LENGTH = 4000

/** metadata.sentAtSource: «message» — настоящее время сообщения, «upload» — время заливки. */
function readSentAtSource(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).sentAtSource
  return typeof value === "string" ? value : null
}

const messageSchema = z.object({
  /** Стабильный id сообщения В ПРЕДЕЛАХ чата (Telegram mid, WhatsApp MsgKey.id). */
  externalId: z.string().trim().min(1).max(200),
  direction: z.enum(["incoming", "outgoing"]),
  text: z.string().max(20000).nullish(),
  /** Время сообщения в мессенджере (ISO или unix-секунды). */
  sentAt: z.union([z.string(), z.number()]).nullish(),
})

const bodySchema = z.object({
  clientId: z.string().uuid(),
  channel: z.enum(MESSENGER_CHANNELS),
  /**
   * Идентификатор чата. НЕОБЯЗАТЕЛЕН с 01.09.2026: в WhatsApp его в разметке
   * нет, и там сервер находит ключ чата сам — по идентификаторам присланных
   * сообщений (они же messages[].externalId). Отдельного поля для этого не
   * заводим: список сообщений уже здесь.
   */
  chatId: z.string().optional(),
  /**
   * Прочие идентификаторы ТОГО ЖЕ чата, увиденные расширением одновременно.
   * По ним находится переписка, залитая из другого клиента мессенджера, —
   * иначе она задваивается: ключ дедупа склеивается с идентификатором чата.
   */
  altIds: z.array(z.string().min(1)).max(4).optional(),
  messages: z.array(messageSchema).min(1).max(50),
})

export async function POST(req: NextRequest) {
  const guard = await requireExtAuth(req, "ext.write")
  if (!guard.ok) return guard.response
  const { ctx } = guard

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
  const { clientId, channel } = parsed.data

  // Ещё не отправленные сообщения отсеиваем: у них временный id, и через
  // секунду то же самое приедет с настоящим — второй строкой в карточке.
  // Это второй рубеж поверх фильтра в адаптере: в браузерах сотрудников
  // какое-то время живут старые сборки расширения.
  const messages = parsed.data.messages.filter((m) => !isLocalMessageId(m.externalId))
  if (messages.length === 0) {
    return extJson(req, {
      created: 0,
      skipped: parsed.data.messages.length,
      repaired: 0,
      removed: 0,
      conflicts: 0,
    })
  }

  // Чат, за которым стоит не один человек, не заливаем. Этот роут опаснее
  // прочих: существующей привязки он не требует вовсе — clientId приходит от
  // панели, — поэтому именно здесь гард обязателен. И проверяем СЫРЫЕ
  // идентификаторы: у WhatsApp признак это суффикс JID, который нормализация
  // уничтожает.
  const rawIds = [parsed.data.chatId, ...(parsed.data.altIds ?? [])]
  if (rawIds.some((raw) => isUnsupportedChat(channel, raw))) {
    return extJson(req, { error: unsupportedChatMessage(channel) }, { status: 400 })
  }

  const ids = splitChatIds(channel, rawIds)

  // Чат без собственного идентификатора (WhatsApp). Ключ находим САМИ — по
  // идентификаторам присланных сообщений, — и обязательно сверяем, что этот чат
  // принадлежит именно тому клиенту, которого назвала панель.
  //
  // Сверка тут несущая, а не формальная. Локально панель различает чаты по
  // заголовку, и два диалога с одинаковой подписью она бы спутала; тогда
  // сообщения одного человека уехали бы в карточку другого — необратимо. Здесь
  // же сверяются ФАКТЫ: сообщения знают свой чат, чат знает своего клиента.
  let mintedChatKey: string | null = null
  if (!ids.canonical) {
    const found = await findChatKeyByMessageIds(
      ctx.tenantId,
      channel,
      messages.map((m) => m.externalId),
    )
    if (found.conflict) {
      return extJson(
        req,
        { error: "Сообщения одного экрана числятся за разными чатами — заливка отменена" },
        { status: 409 },
      )
    }
    if (!found.chatKey) {
      // Чат ещё не привязан: заливать некуда. Привязку создаёт человек через
      // POST /bindings, и только там выдаётся новый ключ.
      return extJson(req, { error: "Чат не привязан к клиенту" }, { status: 400 })
    }
    const owner = await db.chatBinding.findFirst({
      where: {
        tenantId: ctx.tenantId,
        channel: toPrismaChannel(channel),
        externalChatId: found.chatKey,
      },
      select: { clientId: true },
    })
    if (!owner) {
      return extJson(req, { error: "Чат не привязан к клиенту" }, { status: 400 })
    }
    if (owner.clientId !== clientId) {
      return extJson(
        req,
        { error: "Эти сообщения принадлежат чату другого клиента — заливка отменена" },
        { status: 409 },
      )
    }
    mintedChatKey = found.chatKey
  }

  if (!ids.canonical && !mintedChatKey) {
    return extJson(req, { error: "Пустой идентификатор чата" }, { status: 400 })
  }

  // Второй рубеж, по канону: признак группы MAX (минус) нормализацию переживает.
  if (isMaxGroupChatId(channel, ids.canonical)) {
    return extJson(req, { error: unsupportedChatMessage(channel) }, { status: 400 })
  }

  // Канон берём из БАЗЫ, а не из текущего наблюдения: числовой peer id
  // читается из разметки не всегда, и канон «по мешку запроса» скакал бы от
  // захода к заходу — то самое задваивание, ради которого всё и делалось.
  const group = ids.canonical
    ? await resolveChatGroup(ctx.tenantId, channel, ids.all, ids.canonical)
    : { canonical: /** @type {string} */ (mintedChatKey as string), allIds: [mintedChatKey as string] }
  const chatId = group.canonical
  // Под каким идентификатором сообщение приехало ИМЕННО СЕЙЧАС — по нему видно,
  // из какого клиента мессенджера пришла строка. Кладём НОРМАЛИЗОВАННЫМ, а не
  // сырым: ровно так лежат все строки, залитые до 31.08.2026, и по этому же
  // полю ищет перенос переписки при перепривязке чата.
  const incomingChatId = normalizeChatId(channel, parsed.data.chatId) ?? chatId

  const client = await db.client.findFirst({
    where: {
      id: clientId,
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...scopeClientByBranch(ctx.branchScope),
    },
    select: { id: true },
  })
  if (!client) return extJson(req, { error: "Клиент не найден" }, { status: 404 })

  // Алиасы — вся группа, кроме канона: при заходе из /a «@username» в разметке
  // нет вовсе, а история залита из /k именно под ним, и найти её можно только
  // через привязки.
  const aliases = group.allIds.filter((id) => id !== chatId)

  // Разобранное время нужно дважды: и для новых строк, и для починки старых.
  const sentAtByIndex = messages.map((m) => parseMessageSentAt(m.sentAt))

  // ДВОЙНОЕ ЧТЕНИЕ КЛЮЧА — и по канону, и по алиасам. Именно оно делает правку
  // двусторонней дверью: откат кода не порождает дублей, а разовую чистку
  // истории можно откладывать сколько угодно.
  const candidateKeys = [chatId, ...aliases].flatMap((id) =>
    messages.map((m) => buildMessageExternalId(id, m.externalId)),
  )
  const existingRows = await db.communication.findMany({
    where: {
      tenantId: ctx.tenantId,
      clientId,
      channel: toPrismaChannel(channel),
      externalId: { in: candidateKeys },
    },
    select: { id: true, externalId: true, content: true, metadata: true },
  })

  const plan = planCommunicationKeyRepair({
    canonical: chatId,
    aliases,
    messages: messages.map((m, index) => ({
      externalId: m.externalId,
      content: m.text?.slice(0, MAX_TEXT_LENGTH) ?? null,
      sentAt: sentAtByIndex[index] ?? null,
    })),
    existing: existingRows.map((row) => ({
      id: row.id,
      externalId: row.externalId ?? "",
      content: row.content,
      sentAtSource: readSentAtSource(row.metadata),
    })),
    buildKey: buildMessageExternalId,
  })

  const repair = await applyCommunicationKeyRepair(ctx.tenantId, channel, clientId, chatId, plan)

  // Сообщения без разобранного времени (Telegram WebA его не отдаёт вовсе)
  // раскладываем по позиции в пачке: она приходит в хронологическом порядке, а
  // один общий now() на всех схлопнул бы его — в ленте такие строки встали бы
  // как попало относительно друг друга. Шаг в миллисекунду: порядок строгий,
  // а отображаемое время (до минут) остаётся одним и тем же.
  const toInsert = new Set(plan.insert.map((m) => m.externalId))
  const uploadedAt = Date.now()
  const rows = messages
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => toInsert.has(m.externalId))
    .map(({ m, index }) => ({
      tenantId: ctx.tenantId,
      clientId,
      type: messageTypeForDirection(m.direction),
      channel: toPrismaChannel(channel),
      direction: m.direction,
      content: m.text?.slice(0, MAX_TEXT_LENGTH) ?? null,
      // id сообщения уникален лишь внутри чата — ключ склеиваем с КАНОНОМ,
      // иначе одно сообщение из /k и из /a даёт две строки.
      externalId: buildMessageExternalId(chatId, m.externalId),
      sentAt:
        sentAtByIndex[index] ?? new Date(uploadedAt - (messages.length - 1 - index)),
      // Исходящие писал сотрудник, чьим токеном работает панель. У входящих автора
      // нет — сообщение написал клиент. В ленте, впрочем, показывается не он, а
      // рабочее место (metadata.device) — см. lib/communications/author-label.ts.
      employeeId: m.direction === "outgoing" ? ctx.employeeId : null,
      metadata: {
        source: "extension",
        // Рабочее место — название токена, снимком на момент записи. Только у
        // исходящих, ровно как employeeId: подпись обязана отвечать на вопрос
        // «кто это написал». Входящее написал клиент, и приписать ему рабочее
        // место значило бы соврать в ленте.
        ...(m.direction === "outgoing"
          ? { device: ctx.tokenName, tokenId: ctx.tokenId }
          : {}),
        chatId: incomingChatId,
        canonicalChatId: chatId,
        // "message" — настоящее время из разметки, "upload" — время заливки.
        // Без этой пометки порядок заходов навсегда решал бы качество данных:
        // зашли сперва из /a, где времени в разметке нет вовсе, — и безвременная
        // строка глушила бы нормальную из /k, которую skipDuplicates выбросит.
        sentAtSource: sentAtByIndex[index] ? "message" : "upload",
      },
    }))

  const result =
    rows.length > 0
      ? await db.communication.createMany({ data: rows, skipDuplicates: true })
      : { count: 0 }

  // Освежаем примету чата — набор идентификаторов сообщений, по которым он
  // узнаётся (актуально для WhatsApp, где идентификатора чата нет в разметке).
  //
  // Делаем это ЗДЕСЬ, а не только при привязке: переписка растёт, и сообщения,
  // запомненные при привязке, через неделю уедут за пределы видимой части
  // экрана. Без обновления чат перестал бы узнаваться — молча, и человек решил
  // бы, что привязка «слетела».
  if (isMintedChatKey(chatId)) {
    await rememberMessageIds(
      ctx.tenantId,
      channel,
      chatId,
      messages.map((m) => m.externalId),
    )
  }

  return extJson(req, {
    created: result.count,
    skipped: parsed.data.messages.length - result.count,
    repaired: repair.repaired,
    removed: repair.removed,
    conflicts: plan.conflicts,
  })
}
