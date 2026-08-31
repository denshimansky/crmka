import { normalizeChatId, isPositiveNumericChatId, type MessengerChannel } from "@/lib/ext/chat-identity"

/**
 * Канон чата и починка ключей уже залитой переписки
 * (docs/messenger-extension.md §8).
 *
 * ЗАЧЕМ. Один и тот же собеседник приходит из разных клиентов мессенджера под
 * разными идентификаторами. В Telegram это два клиента на одном хосте: WebK (/k)
 * пишет в адрес «@username», если у человека есть ник, а WebA (/a) — всегда
 * числовой peer id. Из-за этого привязка, сделанная в /k, в /a не находилась, а
 * переписка, залитая из обоих, задваивалась в карточке: ключ дедупа сообщения
 * склеивается с идентификатором чата.
 *
 * КАК. Расширение перестало решать, что считать идентификатором чата: оно
 * присылает МЕШОК всего, что увидело в одном открытом диалоге (значение из
 * адресной строки плюс числовой peer id из разметки), а канон выбирает сервер.
 * Одно место вместо трёх адаптеров: правило разное по каналам — в Telegram канон
 * числовой, в MAX это сам chatId, в WhatsApp будет пара «LID ↔ телефон».
 *
 * Здесь только ЧИСТЫЕ функции без обращения к БД — они покрыты юнит-тестами
 * (src/__tests__/ext-chat-canonical.test.ts). Работа с БД — в chat-binding-sync.ts.
 */

/** Строка привязки в том виде, в каком её читают решающие функции. */
export interface ChatBindingRow {
  clientId: string
  externalChatId: string
  canonicalChatId: string | null
}

export interface SplitChatIds {
  /** Идентификатор, под которым ведём чат. null — во входе не осталось ничего. */
  canonical: string | null
  /** Остальные известные идентификаторы того же чата. */
  aliases: string[]
  /** Канон и алиасы одним списком — для запросов `IN (…)`. */
  all: string[]
}

/**
 * Какой из идентификаторов считать каноном.
 *
 * TELEGRAM: первое положительное число. Это единственный случай, где значения
 * двух клиентов доказанно совпадают — у личного чата и WebK, и WebA отдают
 * telegram user id как есть. Отрицательные (группы, супергруппы, каналы) НЕ
 * канонизируем: арифметика клиентов там расходится (WebK «-rawId», WebA
 * «-(10^12 + rawId)»), а отличить базовую группу от супергруппы по одному числу
 * нельзя. Дописать «10^12» — прямой путь положить переписку одного чата в
 * карточку другого.
 *
 * ОСТАЛЬНЫЕ КАНАЛЫ: первый идентификатор, то есть ровно сегодняшнее поведение.
 */
export function chooseCanonicalChatId(
  channel: MessengerChannel,
  ids: readonly string[],
): string | null {
  const list = ids.filter((id) => id.length > 0)
  if (list.length === 0) return null
  if (channel === "telegram") {
    return list.find((id) => isPositiveNumericChatId(id)) ?? list[0]
  }
  return list[0]
}

/**
 * Привести мешок идентификаторов из расширения к канону и алиасам.
 *
 * Нормализация та же, что и раньше (normalizeChatId), плюс дедуп с сохранением
 * порядка: он влияет на выбор канона, когда числа нет вовсе.
 */
export function splitChatIds(
  channel: MessengerChannel,
  rawIds: readonly (string | null | undefined)[],
): SplitChatIds {
  const normalized: string[] = []
  for (const raw of rawIds) {
    const id = normalizeChatId(channel, raw)
    if (id && !normalized.includes(id)) normalized.push(id)
  }
  const canonical = chooseCanonicalChatId(channel, normalized)
  if (!canonical) return { canonical: null, aliases: [], all: [] }
  const aliases = normalized.filter((id) => id !== canonical)
  return { canonical, aliases, all: [canonical, ...aliases] }
}

export type BindingLinkDecision = "noop" | "link" | "conflict"

/**
 * Можно ли достроить каноническую привязку по тому, что уже есть в базе.
 *
 * «link» — все найденные строки указывают на ОДНОГО клиента, а строки на канон
 * ещё нет: значит человек когда-то привязал этот чат по одному идентификатору,
 * и теперь мы знаем второй. Достраиваем — именно это делает привязку из /k
 * находимой в /a.
 *
 * «conflict» — строки указывают на РАЗНЫХ клиентов. Молча выбрать нельзя: цена
 * ошибки необратима (чужая переписка в карточке, а уникальный ключ не даёт её
 * переписать). Решает человек.
 *
 * «noop» — достраивать нечего.
 */
export function decideBindingLink(input: {
  rows: readonly ChatBindingRow[]
  canonical: string | null
}): BindingLinkDecision {
  const { rows, canonical } = input
  if (rows.length === 0 || !canonical) return "noop"
  const clientIds = new Set(rows.map((r) => r.clientId))
  if (clientIds.size > 1) return "conflict"
  const canonRow = rows.find((r) => r.externalChatId === canonical)
  if (!canonRow) return "link"
  // Канон уже за этим клиентом — осталось убедиться, что вся группа помечена.
  return rows.every((r) => r.canonicalChatId === canonical) ? "noop" : "link"
}

/** Сообщение из пачки расширения в том виде, в каком его читает планировщик. */
export interface RepairMessageInput {
  externalId: string
  content: string | null
  /** Разобранное время сообщения; null — его в разметке не было. */
  sentAt: Date | null
}

/** Уже лежащая в базе строка переписки. */
export interface ExistingCommunicationRow {
  id: string
  externalId: string
  content: string | null
  /** metadata.sentAtSource: "message" — настоящее время, "upload" — время заливки. */
  sentAtSource: string | null
}

export interface CommunicationKeyRepairPlan {
  /** Сообщения, которых в базе нет ни под каким ключом. */
  insert: RepairMessageInput[]
  /** Строки, которым нужно сменить ключ на канонический. */
  rename: Array<{ id: string; fromExternalId: string; toExternalId: string }>
  /** Алиасные близнецы канонических строк — их можно убрать. */
  deleteDuplicate: Array<{ id: string; externalId: string }>
  /** Строкам со временем заливки приехало настоящее время. */
  refreshSentAt: Array<{ id: string; sentAt: Date }>
  /** Близнецы с РАЗНЫМ текстом — не трогаем, только считаем. */
  conflicts: number
}

/**
 * Что сделать с ключами уже залитой переписки, чтобы она перестала двоиться.
 *
 * Вызывается на каждой заливке по видимой пачке (≤50 сообщений), поэтому чинит
 * историю лениво и точечно — без миграции по всей базе.
 *
 * Правила намеренно осторожные:
 *   • канонический ключ есть → ничего не вставляем;
 *   • есть только алиасный → ПЕРЕИМЕНОВЫВАЕМ, а не «вставить и удалить»: строка
 *     сохраняет своё время, автора и место в ленте;
 *   • есть оба, и ТЕКСТ СОВПАДАЕТ → алиасного близнеца убираем. Совпадение
 *     текста здесь работает страховкой от кривого канона: если число снято
 *     неверно, тексты не совпадут и мы ничего не удалим;
 *   • есть оба, но текст разный → не трогаем, считаем в conflicts;
 *   • у выжившей строки время было «временем заливки», а в пачке приехало
 *     настоящее → обновляем. Иначе порядок заливки навсегда решал бы качество
 *     данных: зашли сперва из /a, где времени в разметке нет вовсе, — и
 *     безвременная строка глушила бы нормальную из /k.
 */
export function planCommunicationKeyRepair(input: {
  canonical: string
  aliases: readonly string[]
  messages: readonly RepairMessageInput[]
  existing: readonly ExistingCommunicationRow[]
  buildKey: (chatId: string, messageId: string) => string
}): CommunicationKeyRepairPlan {
  const { canonical, aliases, messages, existing, buildKey } = input
  const byKey = new Map(existing.map((row) => [row.externalId, row]))

  const plan: CommunicationKeyRepairPlan = {
    insert: [],
    rename: [],
    deleteDuplicate: [],
    refreshSentAt: [],
    conflicts: 0,
  }

  for (const message of messages) {
    const canonKey = buildKey(canonical, message.externalId)
    const canonRow = byKey.get(canonKey)
    const aliasRows = aliases
      .map((alias) => byKey.get(buildKey(alias, message.externalId)))
      .filter((row): row is ExistingCommunicationRow => Boolean(row))

    if (!canonRow && aliasRows.length === 0) {
      plan.insert.push(message)
      continue
    }

    if (!canonRow) {
      // Только алиасная строка: она и есть это сообщение, просто под старым
      // ключом. Первую переименовываем, остальные (их обычно нет) — близнецы.
      const [head, ...rest] = aliasRows
      plan.rename.push({
        id: head.id,
        fromExternalId: head.externalId,
        toExternalId: canonKey,
      })
      for (const extra of rest) {
        if (extra.content === head.content) {
          plan.deleteDuplicate.push({ id: extra.id, externalId: extra.externalId })
        } else {
          plan.conflicts++
        }
      }
      if (message.sentAt && head.sentAtSource !== "message") {
        plan.refreshSentAt.push({ id: head.id, sentAt: message.sentAt })
      }
      continue
    }

    for (const alias of aliasRows) {
      if (alias.content === canonRow.content) {
        plan.deleteDuplicate.push({ id: alias.id, externalId: alias.externalId })
      } else {
        plan.conflicts++
      }
    }
    if (message.sentAt && canonRow.sentAtSource !== "message") {
      plan.refreshSentAt.push({ id: canonRow.id, sentAt: message.sentAt })
    }
  }

  return plan
}
