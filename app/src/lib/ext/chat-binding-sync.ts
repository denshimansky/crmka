import { db } from "@/lib/db"
import { toPrismaChannel, type MessengerChannel } from "@/lib/ext/chat-identity"
import type { CommunicationKeyRepairPlan } from "@/lib/ext/chat-canonical"

/**
 * Работа с БД поверх чистых функций chat-canonical.ts
 * (docs/messenger-extension.md §8).
 *
 * RLS в проекте не работает (см. память проекта), поэтому tenantId в where —
 * ОБЯЗАТЕЛЕН везде, а не «для порядка». Скоуп любой правки переписки —
 * tenantId + clientId + channel: промах здесь необратим, уникальный ключ не даёт
 * переписать чужую строку.
 */

export interface ChatGroup {
  /**
   * Канон ГРУППЫ по данным базы. Это не то же, что канон текущего наблюдения:
   * числовой peer id читается из разметки не всегда (кадр перехода, старая
   * сборка расширения, уехавшие селекторы), и если брать канон только из
   * запроса, ключ сообщений скакал бы от захода к заходу — ровно то
   * задваивание, ради которого всё и делалось.
   */
  canonical: string
  /** Все идентификаторы группы, включая канон. */
  allIds: string[]
  rows: Array<{
    id: string
    clientId: string
    externalChatId: string
    canonicalChatId: string | null
    wardId: string | null
    displayName: string | null
  }>
}

/**
 * Развернуть группу идентификаторов одного чата — В ОБЕ СТОРОНЫ.
 *
 * Наивный поиск «строки, ссылающиеся на канон» работает, только если канон уже
 * известен. Но расширение может прислать один лишь `@masha`, а канон группы —
 * число: тогда по строке-участнику нужно ПОДНЯТЬСЯ к её канону и уже от него
 * собрать всю группу. Без этого шага заливка заводила бы переписку заново под
 * ником, а отвязка снимала бы одну строку из двух.
 *
 * @param observedIds Что расширение видит прямо сейчас (канон наблюдения + алиасы).
 * @param fallbackCanonical Канон наблюдения — берётся, если в базе группы ещё нет.
 */
export async function resolveChatGroup(
  tenantId: string,
  channel: MessengerChannel,
  observedIds: readonly string[],
  fallbackCanonical: string,
): Promise<ChatGroup> {
  const prismaChannel = toPrismaChannel(channel)
  const select = {
    id: true,
    clientId: true,
    externalChatId: true,
    canonicalChatId: true,
    wardId: true,
    displayName: true,
  } as const

  const seed = await db.chatBinding.findMany({
    where: { tenantId, channel: prismaChannel, externalChatId: { in: [...observedIds] } },
    select,
  })

  // Ключи группы: и то, что видим, и каноны найденных строк — подъём «вверх».
  const groupKeys = new Set<string>(observedIds)
  for (const row of seed) {
    groupKeys.add(row.externalChatId)
    if (row.canonicalChatId) groupKeys.add(row.canonicalChatId)
  }

  const keys = [...groupKeys]
  const rows = keys.length
    ? await db.chatBinding.findMany({
        where: {
          tenantId,
          channel: prismaChannel,
          OR: [{ externalChatId: { in: keys } }, { canonicalChatId: { in: keys } }],
        },
        select,
      })
    : []

  const allIds = new Set<string>(groupKeys)
  for (const row of rows) {
    allIds.add(row.externalChatId)
    if (row.canonicalChatId) allIds.add(row.canonicalChatId)
  }

  // Канон, уже закреплённый в базе, имеет приоритет над каноном наблюдения:
  // ключи уже залитых сообщений построены именно по нему.
  const established = rows.find((row) => row.canonicalChatId)?.canonicalChatId
  return { canonical: established ?? fallbackCanonical, allIds: [...allIds], rows }
}

/**
 * Прежние владельцы этого чата — все клиенты, у кого уже лежит его переписка.
 *
 * Считаем по САМИМ ДАННЫМ, а не по строкам привязок: штатное исправление
 * ошибки — «Отвязать → найти нужного → Привязать», а отвязка удаляет привязки
 * физически, и к моменту новой привязки прежнего владельца по ним не найти.
 * Ключ дедупа («<chatId>:<id сообщения>») есть у каждой строки, включая залитые
 * до появления canonicalChatId.
 */
export async function previousOwnersForChat(
  tenantId: string,
  channel: MessengerChannel,
  chatIds: readonly string[],
): Promise<string[]> {
  if (chatIds.length === 0) return []
  const rows = await db.communication.findMany({
    where: {
      tenantId,
      channel: toPrismaChannel(channel),
      OR: chatIds.map((chatId) => ({ externalId: { startsWith: `${chatId}:` } })),
    },
    select: { clientId: true },
    distinct: ["clientId"],
    take: 20,
  })
  return rows.map((row) => row.clientId)
}

/**
 * Достроить каноническую строку привязки по уже подтверждённой человеком.
 *
 * ГАРДЫ (ослаблять нельзя — это единственный оставшийся путь к «чужой переписке
 * в карточке» и к утечке расписания ребёнка постороннему человеку):
 *   • привязка по одному из идентификаторов УЖЕ существует, то есть человек её
 *     когда-то подтвердил; сами по себе догадки привязок не создают;
 *   • канон и алиас приехали из ОДНОГО наблюдения одного открытого диалога;
 *   • существующую привязку канона на ДРУГОГО клиента не перевешиваем никогда —
 *     это конфликт, и решает его человек.
 */
export async function linkCanonicalBinding(
  tenantId: string,
  channel: MessengerChannel,
  params: { canonical: string; aliases: string[]; employeeId: string | null },
): Promise<boolean> {
  const prismaChannel = toPrismaChannel(channel)
  const { canonical, aliases } = params
  if (aliases.length === 0) return false

  return db.$transaction(async (tx) => {
    const rows = await tx.chatBinding.findMany({
      where: {
        tenantId,
        channel: prismaChannel,
        externalChatId: { in: [canonical, ...aliases] },
      },
      select: {
        id: true,
        clientId: true,
        externalChatId: true,
        wardId: true,
        displayName: true,
      },
    })
    if (rows.length === 0) return false
    const clientIds = new Set(rows.map((row) => row.clientId))
    // Разные клиенты — конфликт, разбирает человек (см. resolve-client.ts).
    if (clientIds.size > 1) return false

    const source = rows.find((row) => row.externalChatId !== canonical) ?? rows[0]
    const hasCanon = rows.some((row) => row.externalChatId === canonical)

    if (!hasCanon) {
      await tx.chatBinding.create({
        data: {
          tenantId,
          channel: prismaChannel,
          externalChatId: canonical,
          canonicalChatId: canonical,
          clientId: source.clientId,
          wardId: source.wardId,
          displayName: source.displayName,
          createdBy: params.employeeId,
          lastSeenAt: new Date(),
        },
      })
    }

    // Пометить всю группу общим каноном — по нему собираются алиасы при заходе
    // из клиента, где второго идентификатора в разметке нет.
    await tx.chatBinding.updateMany({
      where: {
        tenantId,
        channel: prismaChannel,
        externalChatId: { in: [canonical, ...aliases] },
        clientId: source.clientId,
      },
      data: { canonicalChatId: canonical },
    })
    return true
  })
}

/**
 * Исполнить план починки ключей переписки.
 *
 * Всё в одной транзакции и строго в пределах одного клиента: объём ограничен
 * размером видимой пачки, операция идемпотентна (повторный прогон даст пустой
 * план). В metadata остаётся keyRepairedFrom — по нему правку можно откатить.
 */
export async function applyCommunicationKeyRepair(
  tenantId: string,
  channel: MessengerChannel,
  clientId: string,
  canonical: string,
  plan: CommunicationKeyRepairPlan,
): Promise<{ repaired: number; removed: number }> {
  const prismaChannel = toPrismaChannel(channel)
  if (plan.rename.length === 0 && plan.deleteDuplicate.length === 0 && plan.refreshSentAt.length === 0) {
    return { repaired: 0, removed: 0 }
  }

  return db.$transaction(async (tx) => {
    // Близнецов убираем ПЕРВЫМИ: иначе переименование упрётся в уникальный ключ.
    let removed = 0
    if (plan.deleteDuplicate.length > 0) {
      const result = await tx.communication.deleteMany({
        where: {
          tenantId,
          clientId,
          channel: prismaChannel,
          id: { in: plan.deleteDuplicate.map((row) => row.id) },
        },
      })
      removed = result.count
    }

    let repaired = 0
    for (const item of plan.rename) {
      const row = await tx.communication.findFirst({
        where: { id: item.id, tenantId, clientId, channel: prismaChannel },
        select: { metadata: true },
      })
      if (!row) continue
      // Уникальный ключ (tenantId, channel, externalId) НЕ включает клиента, а
      // «что уже есть» мы читали в скоупе ЭТОГО клиента. Если тот же чат когда-то
      // залили ошибочно другому, целевой ключ уже занят — переименование уронило
      // бы всю транзакцию, и заливка ответила бы 500 вместо работы. Такую строку
      // просто пропускаем: она чинится перепривязкой (moveCommunicationsOnRebind).
      const taken = await tx.communication.findFirst({
        where: {
          tenantId,
          channel: prismaChannel,
          externalId: item.toExternalId,
          NOT: { id: item.id },
        },
        select: { id: true },
      })
      if (taken) continue
      const metadata =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {}
      await tx.communication.update({
        where: { id: item.id },
        data: {
          externalId: item.toExternalId,
          metadata: {
            ...metadata,
            canonicalChatId: canonical,
            // Обратимость: по этому полю видно, каким ключ был до починки.
            keyRepairedFrom: item.fromExternalId,
          },
        },
      })
      repaired++
    }

    for (const item of plan.refreshSentAt) {
      const row = await tx.communication.findFirst({
        where: { id: item.id, tenantId, clientId, channel: prismaChannel },
        select: { metadata: true },
      })
      if (!row) continue
      const metadata =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {}
      await tx.communication.update({
        where: { id: item.id },
        data: {
          sentAt: item.sentAt,
          // Пометку ставим вместе со временем, иначе план починки НИКОГДА не
          // пустеет: у строк, залитых до 31.08.2026, sentAtSource нет вовсе, и
          // они попадали бы в обновление на каждой заливке.
          metadata: { ...metadata, sentAtSource: "message" },
        },
      })
    }

    return { repaired, removed }
  })
}

/**
 * Перенести залитую расширением переписку на другого клиента при перепривязке.
 *
 * Сегодня ошибочную привязку исправить нельзя в принципе: переписка остаётся у
 * неверного клиента, а правильному заливка блокируется уникальным ключом.
 * Коллизий здесь быть не может — externalId не меняется, меняется только clientId.
 * Операция обратима повторной перепривязкой.
 */
export async function moveCommunicationsOnRebind(
  tenantId: string,
  channel: MessengerChannel,
  fromClientId: string,
  toClientId: string,
  chatIds: string[],
): Promise<number> {
  if (fromClientId === toClientId || chatIds.length === 0) return 0
  const result = await db.communication.updateMany({
    where: {
      tenantId,
      clientId: fromClientId,
      channel: toPrismaChannel(channel),
      // Отбираем по САМОМУ КЛЮЧУ дедупа («<chatId>:<id сообщения>»), а не по
      // metadata: ключ есть у всех строк, включая залитые до появления
      // canonicalChatId, и по нему же гарантируется, что это сообщения именно
      // ЭТОГО чата. Заметки, звонки и переписка других чатов клиента такого
      // префикса не имеют и остаются на месте.
      OR: chatIds.map((chatId) => ({ externalId: { startsWith: `${chatId}:` } })),
    },
    data: { clientId: toClientId },
  })
  return result.count
}
