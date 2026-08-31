import type { CommunicationChannel } from "@prisma/client"
import { phoneMatchKey } from "@/lib/phone"

/**
 * Нормализация идентификаторов чата и мессенджер-хендлов
 * (docs/messenger-extension.md).
 *
 * Зачем: один и тот же собеседник приходит из расширения по-разному —
 * «@masha», «https://t.me/masha», «Masha» — а в карточке клиента поля
 * telegram/vk/max заполняются людьми свободным текстом (ссылка, ник, id).
 * Чтобы привязка чата находилась, обе стороны приводим к одному виду.
 *
 * Здесь только чистые функции без обращения к БД — их можно покрывать
 * юнит-тестами (npm run test:unit).
 */

/** Каналы, по которым работает расширение (внутренние/телефон/почта — не они). */
export const MESSENGER_CHANNELS = ["whatsapp", "telegram", "vk", "max"] as const

export type MessengerChannel = (typeof MESSENGER_CHANNELS)[number]

export function isMessengerChannel(value: string): value is MessengerChannel {
  return (MESSENGER_CHANNELS as readonly string[]).includes(value)
}

/**
 * Приводит идентификатор чата к каноническому виду для хранения в
 * ChatBinding.externalChatId и сравнения с полями карточки.
 *
 * Telegram: «@masha», «t.me/masha», «https://web.telegram.org/k/#@masha» → «masha»;
 *           числовой peer id остаётся числом (в WebA хэш всегда числовой).
 * VK:       «vk.com/id12345», «https://vk.com/durov», «id12345» → «id12345» / «durov»;
 *           числовой peer id → как есть.
 * WhatsApp: «79991234567@c.us», «+7 (999) 123-45-67» → последние 10 цифр
 *           (тот же ключ, что у findClientsByPhone); LID-идентификаторы
 *           («12345@lid») сохраняем как «lid:12345» — номера за ними нет.
 * MAX:      «web.max.ru/1234567890123» → «1234567890123»;
 *           «web.max.ru/c/1234567890123/987» → «1234567890123» (первый значащий
 *           сегмент пути); состояния интерфейса («/:chat-list») → null.
 *           chatId хранится КАК ЕСТЬ: это не телефон (см. normalizeMaxChatId).
 *
 * Возвращает null, если после очистки ничего не осталось.
 */
export function normalizeChatId(channel: MessengerChannel, raw: string | null | undefined): string | null {
  if (!raw) return null
  let value = raw.trim()
  if (!value) return null

  // Срезаем протокол и известные хосты, оставляя «хвост» — сам идентификатор.
  value = value.replace(/^https?:\/\//i, "")
  value = value.replace(
    /^(?:web\.telegram\.org\/[ka]\/?#?|t\.me\/|telegram\.me\/|m\.vk\.com\/|web\.vk\.me\/|vk\.com\/|vk\.ru\/|vk\.me\/|web\.max\.ru\/|max\.ru\/|web\.whatsapp\.com\/)/i,
    "",
  )
  value = value.replace(/^@+/, "").trim()

  // MAX разбираем ДО общей обрезки: у него путь многосегментный, и обрезка по
  // первому «/» схлопывала бы ВСЕ групповые чаты в один ключ «c».
  if (channel === "max") return normalizeMaxChatId(value)

  // Отрезаем query/хвост пути: «durov?w=wall1_1» → «durov».
  value = value.split(/[?#/]/)[0]?.trim() ?? ""
  if (!value) return null

  switch (channel) {
    case "whatsapp": {
      // «<id>@lid» — WhatsApp прячет номер (тренд 2025-2026, LID/username):
      // сохраняем сам LID, матч по телефону тут невозможен.
      const lid = /^(\d+)@lid$/i.exec(value)
      if (lid) return `lid:${lid[1]}`
      const jid = /^(\d+)@(?:c\.us|s\.whatsapp\.net)$/i.exec(value)
      const digitsSource = jid ? jid[1] : value
      return phoneMatchKey(digitsSource) ?? value.toLowerCase()
    }
    case "telegram":
    case "vk":
      // Регистр в username не значим: «Durov» и «durov» — один аккаунт.
      return value.toLowerCase()
  }
}

/**
 * Служебные префиксы маршрутов MAX — не часть идентификатора чата.
 * «/c/<chatId>/<messageId>» — сообщение в канале, «/u/<id>» — профиль и т.д.
 */
const MAX_ROUTE_PREFIXES = new Set([
  "c",
  "u",
  "join",
  "joincall",
  "stickerset",
  "_storybook",
])

/**
 * Идентификатор чата MAX — ПЕРВЫЙ ЗНАЧАЩИЙ СЕГМЕНТ ПУТИ, как есть.
 *
 * Здесь было две мины, и обе вели к чужой переписке в карточке клиента.
 *
 * ПЕРВАЯ: chatId прогонялся через phoneMatchKey с комментарием «MAX завязан на
 * номер телефона». Но chatId в MAX — это длинное число, а не номер: phoneMatchKey
 * брал у него последние 10 цифр (старшие разряды терялись молча), а у строки с
 * буквами выбрасывал буквы целиком. Дальше resolve-client искал по этому обрезку
 * КЛИЕНТА ПО ТЕЛЕФОНУ и при единственном совпадении подставлял его без участия
 * человека. Телефон теперь принимается только отдельным явным полем — так же,
 * как это давно сделано для Telegram.
 *
 * ВТОРАЯ: общая обрезка пути по первому «/» превращала «web.max.ru/c/123/987» в
 * «c». Все групповые чаты и каналы схлопывались в ОДИН ключ, а уникальный индекс
 * (tenantId, channel, externalChatId) склеивал их в одну привязку. Эта коллизия
 * опаснее телефонной: она не случайная, а системная.
 *
 * Значение возвращаем в нижнем регистре — как у telegram/vk, регистр не значим.
 */
function normalizeMaxChatId(value: string): string | null {
  // Query и хэш отрезаем, путь разбираем целиком.
  const path = value.split(/[?#]/)[0] ?? ""
  for (const segment of path.split("/")) {
    const part = segment.trim()
    if (!part) continue
    // Псевдо-маршруты состояния интерфейса («:chat-list», «:settings/...») —
    // это не чат, и привязывать их к клиенту нельзя.
    if (part.startsWith(":")) return null
    if (MAX_ROUTE_PREFIXES.has(part.toLowerCase())) continue
    return part.toLowerCase()
  }
  return null
}

/**
 * Положительное число — ЛИЧНЫЙ чат Telegram (пользователь или бот).
 *
 * Единственный случай, где идентификатор одного и того же собеседника
 * доказанно совпадает в двух клиентах Telegram Web: и WebK, и WebA отдают
 * telegram user id как есть. У групп, супергрупп и каналов (число со знаком
 * минус) арифметика клиентов расходится, и по одному числу отличить базовую
 * группу от супергруппы нельзя — такие чаты канонизировать НЕЛЬЗЯ.
 */
export function isPositiveNumericChatId(value: string | null | undefined): boolean {
  if (!value) return false
  return /^\d+$/.test(value) && value !== "0"
}

/**
 * Id ещё не отправленного сообщения (временный, дробный — «222237.0001»).
 *
 * Второй рубеж поверх фильтра в адаптере: в браузерах сотрудников какое-то
 * время живут старые сборки расширения, а такой ключ означает вторую строку в
 * карточке — через секунду то же сообщение приедет с настоящим id.
 */
export function isLocalMessageId(value: string | null | undefined): boolean {
  if (!value) return false
  return /^\d+\.\d+$/.test(value.trim())
}

/**
 * Нормализует значение поля-хендла из карточки клиента (Client.telegram/vk/max),
 * чтобы сравнивать его с normalizeChatId. Те же правила — отдельная функция
 * нужна лишь как читаемая точка вызова на стороне резолва.
 */
export function normalizeHandle(
  channel: MessengerChannel,
  raw: string | null | undefined,
): string | null {
  return normalizeChatId(channel, raw)
}

/** Поле карточки клиента, где хранится хендл этого канала (у WhatsApp его нет — там телефон). */
export function handleFieldForChannel(channel: MessengerChannel): "telegram" | "vk" | "max" | null {
  switch (channel) {
    case "telegram":
      return "telegram"
    case "vk":
      return "vk"
    case "max":
      return "max"
    case "whatsapp":
      return null
  }
}

/**
 * Стабильный ключ дедупликации сообщения для Communication.externalId.
 * Уникальность в БД — по паре (tenantId, channel, externalId), поэтому канал
 * в ключ не включаем, но чат включаем: id сообщения уникален только внутри чата
 * (так устроен Telegram — mid уникален в пределах пира).
 */
export function buildMessageExternalId(chatId: string, messageId: string): string {
  return `${chatId}:${messageId}`
}

/**
 * Время сообщения из мессенджера → Date, а «не смогли разобрать» → undefined,
 * НЕ null.
 *
 * Разница принципиальная: Prisma трактует undefined как «поле не задано» и
 * оставляет дефолт колонки (now(), миграция 20260828150000), а явный null
 * пишет в базу NULL. Адаптеры отдают sentAt: null штатно — Telegram WebA
 * машинного времени в разметке не имеет вовсе, — и с null сюда уезжала
 * переписка без времени: в лентах CRM (сортировка nulls: "last") такие строки
 * падают в самый низ истории, а в панели — наоборот всплывают наверх.
 * Время заливки — плохое приближение, но монотонное и не ломающее порядок.
 *
 * Принимаем ISO-строку и unix-время в секундах (так отдаёт WhatsApp Store) или
 * миллисекундах.
 */
export function parseMessageSentAt(
  value: string | number | null | undefined,
): Date | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return undefined
    const ms = value > 1e12 ? value : value * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? undefined : d
  }
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const d = new Date(trimmed)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Тип коммуникации по направлению — универсальный, канал несёт поле channel. */
export function messageTypeForDirection(direction: "incoming" | "outgoing") {
  return direction === "incoming" ? ("messenger_incoming" as const) : ("messenger_outgoing" as const)
}

/** Канал мессенджера → значение enum Prisma (типобезопасное сужение). */
export function toPrismaChannel(channel: MessengerChannel): CommunicationChannel {
  return channel as CommunicationChannel
}
