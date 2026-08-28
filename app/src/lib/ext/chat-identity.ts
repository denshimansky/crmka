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
 * MAX:      номер телефона → последние 10 цифр; иначе — как есть.
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
    case "max": {
      // MAX завязан на номер телефона; если пришёл не номер — оставляем как есть.
      const key = phoneMatchKey(value)
      return key ?? value.toLowerCase()
    }
    case "telegram":
    case "vk":
      // Регистр в username не значим: «Durov» и «durov» — один аккаунт.
      return value.toLowerCase()
  }
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

/** Тип коммуникации по направлению — универсальный, канал несёт поле channel. */
export function messageTypeForDirection(direction: "incoming" | "outgoing") {
  return direction === "incoming" ? ("messenger_incoming" as const) : ("messenger_outgoing" as const)
}

/** Канал мессенджера → значение enum Prisma (типобезопасное сужение). */
export function toPrismaChannel(channel: MessengerChannel): CommunicationChannel {
  return channel as CommunicationChannel
}
