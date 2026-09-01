import { randomUUID } from "crypto"
import { db } from "@/lib/db"
import {
  MINTED_CHAT_KEY_PREFIX,
  toPrismaChannel,
  type MessengerChannel,
} from "@/lib/ext/chat-identity"

/**
 * Опознание чата по идентификаторам его сообщений
 * (docs/messenger-extension.md §8, Фаза 5).
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ ЕСТЬ. WhatsApp Web не выводит наружу идентификатор чата
 * НИКАК — установлено живым прогоном 01.09.2026: скан всех атрибутов всех
 * элементов страницы не находит ни одного JID, а `data-id` строки сообщения
 * оказался идентификатором САМОГО СООБЩЕНИЯ. Единственная прямая опора —
 * телефон в заголовке чата, но он виден лишь у контактов, не сохранённых в
 * телефонной книге сотрудника; у сохранённых там имя.
 *
 * ПОЧЕМУ НЕ ПО ИМЕНИ. Соблазн очевиден — имя есть всегда. Но два клиента с
 * одинаковой подписью схлопнулись бы в одну карточку, а переименование контакта
 * рвало бы привязку. Цена ошибки необратима: уникальный ключ (tenantId, channel,
 * externalId) не даст потом убрать чужую переписку из карточки.
 *
 * КАК УСТРОЕНО. Чат опознаётся по сообщениям, которые в нём лежат:
 * идентификатор сообщения уникален и не меняется, поэтому «чат, где встречается
 * сообщение X» — устойчивая примета. При привязке сервер выдаёт чату
 * синтетический ключ и запоминает увиденные идентификаторы; при следующем
 * открытии расширение присылает то, что видит, и сервер по ним находит ключ.
 *
 * ЧТО ХРАНИТСЯ: только идентификаторы, никакого содержимого сообщений.
 */

/**
 * Сколько идентификаторов принимаем за один запрос.
 *
 * Расширение отдаёт хвост ленты (10 сообщений), но лимит нужен как граница
 * доверия: запрос приходит из браузера сотрудника, и присланный список — это
 * вход, а не факт. Двадцать даёт запас на альбомы и на будущее увеличение хвоста.
 */
const MAX_REFS = 20

/**
 * Форма идентификатора сообщения WhatsApp: hex-строка из 8–64 символов
 * («2A339FE00B7E3BFBC263»). Проверка нужна не для красоты — по этим значениям
 * строится ключ дедупа переписки, и пускать сюда что попало нельзя.
 *
 * Допускаем и цифро-буквенные идентификаторы других каналов на будущее, но
 * длину ограничиваем: короткая строка приметой быть не может, она слишком
 * вероятно совпадёт.
 */
const MESSAGE_ID_RE = /^[A-Za-z0-9._=-]{8,64}$/

/** Отсев мусора и дублей из присланного списка. */
export function sanitizeMessageIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== "string") continue
    const value = item.trim()
    if (!value || seen.has(value) || !MESSAGE_ID_RE.test(value)) continue
    seen.add(value)
    out.push(value)
    if (out.length >= MAX_REFS) break
  }
  return out
}

/**
 * Новый синтетический ключ чата.
 *
 * Префикс обязателен и несёт смысл: по нему в базе видно, что идентификатор
 * выдан НАМИ, а не прочитан из мессенджера. Без префикса такой ключ однажды
 * попытались бы разобрать как телефон или как JID — ровно та ошибка, что уже
 * случалась в MAX.
 */
export function mintChatKey(): string {
  return `${MINTED_CHAT_KEY_PREFIX}${randomUUID()}`
}

/**
 * Найти ключ чата по идентификаторам его сообщений.
 *
 * ПРО НЕОДНОЗНАЧНОСТЬ. В норме все присланные идентификаторы ведут в один чат:
 * сообщение принадлежит ровно одному диалогу. Разнобой означает либо испорченные
 * данные, либо что-то, чего мы не понимаем, — и тогда правильный ответ «не
 * знаю», а не «выберу тот, которого больше». Молчаливый выбор здесь означал бы
 * чужую переписку в карточке, а это необратимо.
 *
 * @returns ключ чата, либо null (не нашли), либо признак противоречия.
 */
export async function findChatKeyByMessageIds(
  tenantId: string,
  channel: MessengerChannel,
  messageIds: string[],
): Promise<{ chatKey: string | null; conflict: boolean; matched: number }> {
  const ids = sanitizeMessageIds(messageIds)
  if (!ids.length) return { chatKey: null, conflict: false, matched: 0 }

  const rows = await db.chatMessageRef.findMany({
    where: { tenantId, channel: toPrismaChannel(channel), messageId: { in: ids } },
    select: { chatKey: true },
  })
  if (!rows.length) return { chatKey: null, conflict: false, matched: 0 }

  const keys = new Set(rows.map((r) => r.chatKey))
  if (keys.size > 1) return { chatKey: null, conflict: true, matched: rows.length }
  return { chatKey: [...keys][0], conflict: false, matched: rows.length }
}

/**
 * Запомнить, что эти сообщения принадлежат этому чату.
 *
 * Зовётся не только при привязке, но и при КАЖДОМ успешном опознании: примета
 * обязана обновляться вместе с перепиской. Иначе через неделю все запомненные
 * сообщения уедут вверх за пределы видимой части, и чат перестанет узнаваться —
 * причём молча.
 *
 * Ошибки глотаем: это вспомогательная память, а не условие работы панели.
 * Не записали — в худшем случае человек привяжет чат заново.
 */
export async function rememberMessageIds(
  tenantId: string,
  channel: MessengerChannel,
  chatKey: string,
  messageIds: string[],
): Promise<number> {
  const ids = sanitizeMessageIds(messageIds)
  if (!ids.length || !chatKey) return 0

  const prismaChannel = toPrismaChannel(channel)
  let written = 0
  for (const messageId of ids) {
    try {
      await db.chatMessageRef.upsert({
        where: {
          tenantId_channel_messageId: { tenantId, channel: prismaChannel, messageId },
        },
        // Сообщение уже известно — обновляем только отметку времени. chatKey НЕ
        // трогаем сознательно: если он вдруг разошёлся, это противоречие, и
        // разбирать его должен человек, а не тихая перезапись.
        update: { seenAt: new Date() },
        create: { tenantId, channel: prismaChannel, messageId, chatKey },
      })
      written++
    } catch {
      // Гонка двух вкладок на одном сообщении — не повод ломать ответ панели.
    }
  }
  return written
}
