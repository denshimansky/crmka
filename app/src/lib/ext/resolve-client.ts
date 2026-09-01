import { db } from "@/lib/db"
import { findClientsByPhone } from "@/lib/clients/find-by-phone"
import { scopeClientByBranch } from "@/lib/client-segments"
import { clientStateLabel } from "@/lib/clients/state-label"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import type { ExtContext } from "@/lib/ext-auth"
import {
  acceptsPhoneParam,
  handleFieldForChannel,
  isMaxGroupChatId,
  isUnsupportedChat,
  normalizeHandle,
  toPrismaChannel,
  type MessengerChannel,
} from "@/lib/ext/chat-identity"
import { decideBindingLink, splitChatIds } from "@/lib/ext/chat-canonical"
import {
  findChatKeyByMessageIds,
  rememberMessageIds,
  sanitizeMessageIds,
} from "@/lib/ext/chat-message-refs"
import { linkCanonicalBinding } from "@/lib/ext/chat-binding-sync"

/**
 * Можно ли считать нормализованный chatId WhatsApp телефоном.
 *
 * Только РОВНО десять цифр. Это не перестраховка, а закрытие конкретной дыры:
 * phoneMatchKey отдаёт ключ любой длины от семи цифр, а findClientsByPhone
 * сравнивает `right(phone, длина_ключа) = ключ` — то есть на семизначном ключе
 * матч идёт по последним семи цифрам и ловит СОВЕРШЕННО ПОСТОРОННЕГО клиента.
 * А дальше, при единственном кандидате, панель подставляет его без участия
 * человека и начинает лить в его карточку чужую переписку.
 *
 * Настоящий номер WhatsApp — международный, 10 значащих цифр после обрезки, так
 * что ограничение не отсекает ни одного живого случая. «lid:…» сюда не проходит
 * по построению: за LID номера нет вовсе.
 */
function whatsappChatIdAsPhone(chatId: string | null): string | null {
  if (!chatId) return null
  return /^\d{10}$/.test(chatId) ? chatId : null
}

/**
 * Поиск клиента по открытому чату (docs/messenger-extension.md).
 *
 * Порядок — от точного к предположительному:
 *   1. ChatBinding — сотрудник уже привязывал этот чат: ответ однозначный;
 *   2. телефон — работает честно только в WhatsApp/MAX (там аккаунт = номер);
 *   3. хендл из карточки (telegram/vk/max) — если номер недоступен;
 *   4. ничего не нашли → расширение предложит привязать вручную или создать лида.
 *
 * Кандидатов может быть несколько (два клиента с одним телефоном — обычное дело
 * для семей): тогда выбор делает человек, автоматически не привязываем.
 *
 * Везде обязателен tenantId (RLS в проекте не работает) и филиальный scope —
 * иначе через расширение утечёт клиент чужого филиала.
 */

export interface ExtClientCandidate {
  id: string
  name: string
  phone: string | null
  funnelStatus: string
  clientStatus: string | null
  /** Человеческий статус («Активный», «Лид», «Архив») — панель показывает его рядом с именем. */
  stateLabel: string
}

export type ExtResolveMatch =
  | "binding"
  | "phone"
  | "handle"
  | "conflict"
  /** Чат такого рода панель не обслуживает — например, групповой чат MAX. */
  | "unsupported"
  | "none"

export interface ExtResolveResult {
  match: ExtResolveMatch
  /** Заполнено, когда клиент определён однозначно. */
  clientId: string | null
  /** Кандидаты для ручного выбора, когда однозначности нет. */
  candidates: ExtClientCandidate[]
  /** Нормализованный id чата — его же расширение шлёт при привязке. */
  chatId: string | null
  /**
   * Под каким идентификатором сервер ведёт этот чат. По нему же строится ключ
   * дедупа сообщений, поэтому переписка одного человека из /k и из /a больше
   * не задваивается.
   */
  canonicalChatId?: string | null
}

function clientName(c: { firstName: string | null; lastName: string | null }): string {
  return [c.lastName, c.firstName].filter(Boolean).join(" ").trim() || "Без имени"
}

/**
 * Резолвит чат в клиента.
 *
 * @param phone — телефон собеседника, если канал его отдаёт (WhatsApp).
 */
export async function resolveClientForChat(
  ctx: ExtContext,
  params: {
    channel: MessengerChannel
    chatId?: string | null
    /**
     * Прочие идентификаторы ЭТОГО ЖЕ чата, увиденные расширением в один
     * момент. В Telegram это @username из адресной строки и числовой peer id
     * из разметки: один и тот же человек, два разных ключа.
     */
    altIds?: readonly string[]
    phone?: string | null
    /**
     * Идентификаторы видимых сообщений — примета чата для каналов, где
     * идентификатора чата нет в разметке вовсе (сегодня это WhatsApp, см.
     * lib/ext/chat-message-refs.ts). Старое расширение их не шлёт — тогда
     * список пуст и поведение ровно прежнее.
     */
    messageIds?: readonly string[]
  },
): Promise<ExtResolveResult> {
  // Чат, который панель не ведёт (группа, рассылка, канал), отбиваем ПО СЫРЫМ
  // идентификаторам — до нормализации. У WhatsApp признак это суффикс JID, и
  // splitChatIds его уничтожает: «120363…@g.us» становится десятизначным
  // числом, неотличимым от телефона, и дальше по нему ищется клиент ПО НОМЕРУ.
  const rawIds = [params.chatId, ...(params.altIds ?? [])]
  if (rawIds.some((raw) => isUnsupportedChat(params.channel, raw))) {
    return {
      match: "unsupported",
      clientId: null,
      candidates: [],
      chatId: null,
      canonicalChatId: null,
    }
  }

  const ids = splitChatIds(params.channel, rawIds)
  const chatId = ids.canonical

  // Второй рубеж — по канону. Групповой чат MAX ловится и здесь: его признак
  // (минус) нормализацию переживает. Оставлен сознательно, дублирование тут
  // дешевле пропуска.
  if (isMaxGroupChatId(params.channel, chatId)) {
    return {
      match: "unsupported",
      clientId: null,
      candidates: [],
      chatId,
      canonicalChatId: chatId,
    }
  }

  const scope = scopeClientByBranch(ctx.branchScope)
  const empty: ExtResolveResult = {
    match: "none",
    clientId: null,
    candidates: [],
    chatId,
    canonicalChatId: chatId,
  }

  // 0. Примета по сообщениям — для каналов, где идентификатора чата в разметке
  // НЕТ (WhatsApp). Стоит первой, потому что даёт готовый ключ чата, с которым
  // дальше работает обычная логика привязки: без неё такой чат вообще нечем
  // назвать. Если у чата есть свой идентификатор (Telegram, MAX) — сюда просто
  // не попадаем, список сообщений оттуда не приходит.
  const messageIds = sanitizeMessageIds(params.messageIds ?? [])
  if (!chatId && messageIds.length) {
    const found = await findChatKeyByMessageIds(ctx.tenantId, params.channel, messageIds)
    if (found.conflict) {
      // Сообщения одного экрана ведут в РАЗНЫЕ чаты. В норме невозможно:
      // сообщение принадлежит одному диалогу. Значит данные испорчены — и
      // правильный ответ «не знаю», а не «выберу тот, которого больше».
      return { match: "none", clientId: null, candidates: [], chatId: null, canonicalChatId: null }
    }
    if (found.chatKey) {
      const binding = await db.chatBinding.findFirst({
        where: {
          tenantId: ctx.tenantId,
          channel: toPrismaChannel(params.channel),
          externalChatId: found.chatKey,
        },
        select: { clientId: true },
      })
      if (binding) {
        const visible = await db.client.findFirst({
          where: { id: binding.clientId, tenantId: ctx.tenantId, deletedAt: null, ...scope },
          select: { id: true },
        })
        if (visible) {
          // Примету обновляем: переписка растёт, и запомненные сообщения
          // однажды уедут за пределы видимой части экрана. Без обновления чат
          // перестал бы узнаваться — причём молча.
          void rememberMessageIds(ctx.tenantId, params.channel, found.chatKey, messageIds)
          await db.chatBinding
            .updateMany({
              where: {
                tenantId: ctx.tenantId,
                channel: toPrismaChannel(params.channel),
                externalChatId: found.chatKey,
              },
              data: { lastSeenAt: new Date() },
            })
            .catch(() => {})
          return {
            match: "binding",
            clientId: binding.clientId,
            candidates: [],
            chatId: found.chatKey,
            canonicalChatId: found.chatKey,
          }
        }
      }
    }
  }

  // 1. Готовая привязка. Ищем по ВСЕМ известным идентификаторам чата, а не
  // только по канону: привязку могли сделать в другом клиенте мессенджера,
  // где тот же человек называется иначе (в /k «@username», в /a число).
  // Проверяем и то, что клиент всё ещё виден этому сотруднику — привязку мог
  // сделать коллега с доступом к другому филиалу.
  if (chatId) {
    const rows = await db.chatBinding.findMany({
      where: {
        tenantId: ctx.tenantId,
        channel: toPrismaChannel(params.channel),
        externalChatId: { in: ids.all },
      },
      select: { clientId: true, externalChatId: true, canonicalChatId: true },
    })

    const boundClientIds = [...new Set(rows.map((row) => row.clientId))]
    if (boundClientIds.length > 1) {
      // Идентификаторы ОДНОГО чата ведут к РАЗНЫМ клиентам: так бывает, если
      // привязку в /k и в /a сделали на разных людей. Выбрать молча нельзя —
      // промах необратим, ключ дедупа не даёт переписать чужую переписку.
      // Показываем обоих и ждём человека; заливку панель в этом состоянии
      // не запускает.
      const visible = await db.client.findMany({
        where: { id: { in: boundClientIds }, tenantId: ctx.tenantId, deletedAt: null, ...scope },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          funnelStatus: true,
          clientStatus: true,
        },
      })
      if (visible.length > 1) {
        return {
          match: "conflict",
          clientId: null,
          candidates: visible.map((c) => ({
            id: c.id,
            name: clientName(c),
            phone: maskPhone(c.phone, ctx.role, ctx.instructorsSeePhones),
            funnelStatus: c.funnelStatus as string,
            clientStatus: c.clientStatus as string | null,
            stateLabel: clientStateLabel(c.funnelStatus, c.clientStatus),
          })),
          chatId,
          canonicalChatId: chatId,
        }
      }
    }

    if (rows.length > 0) {
      const boundClientId = rows[0].clientId
      const visible = await db.client.findFirst({
        where: { id: boundClientId, tenantId: ctx.tenantId, deletedAt: null, ...scope },
        select: { id: true },
      })
      if (visible) {
        // Достраиваем каноническую строку по уже подтверждённой человеком —
        // именно это делает привязку из /k находимой в /a, где @username в
        // разметке не существует вовсе. Побочный эффект в GET осознан:
        // рядом тем же образом обновляется lastSeenAt.
        if (ids.aliases.length > 0 && decideBindingLink({ rows, canonical: chatId }) === "link") {
          await linkCanonicalBinding(ctx.tenantId, params.channel, {
            canonical: chatId,
            aliases: ids.aliases,
            employeeId: ctx.employeeId,
          }).catch(() => {})
        }
        // Отметка «чат виден сейчас» — по ней в CRM видно живые привязки.
        void db.chatBinding
          .updateMany({
            where: {
              tenantId: ctx.tenantId,
              channel: toPrismaChannel(params.channel),
              externalChatId: { in: ids.all },
            },
            data: { lastSeenAt: new Date() },
          })
          .catch(() => {})
        return { match: "binding", clientId: boundClientId, candidates: [], chatId, canonicalChatId: chatId }
      }
    }
  }

  // 2. Телефон. Только WhatsApp: там аккаунт И ЕСТЬ номер, поэтому
  // нормализованный chatId — уже ключ номера, тот же, что у findClientsByPhone.
  //
  // MAX сюда НЕ входит, хотя раньше входил: его chatId — длинное число, а не
  // телефон, и поиск клиента по нему как по номеру подставлял ЧУЖОГО человека с
  // совпадающим хвостом. Телефон в MAX приходит отдельным явным полем params.phone
  // (как в Telegram) — если канал вообще сможет его отдать: он закрыт настройкой
  // приватности.
  const phoneInput =
    (acceptsPhoneParam(params.channel) ? params.phone : null) ??
    (params.channel === "whatsapp" ? whatsappChatIdAsPhone(chatId) : null)

  if (phoneInput) {
    const found = await findClientsByPhone(db, ctx.tenantId, phoneInput, { limit: 5 })
    if (found.length > 0) {
      // Филиальный scope findClientsByPhone не применяет (это обязанность
      // вызывающего) — досеиваем сами.
      const foundIds = found.map((c) => c.id)
      const visible = await db.client.findMany({
        where: { id: { in: foundIds }, tenantId: ctx.tenantId, deletedAt: null, ...scope },
        select: { id: true },
      })
      const visibleIds = new Set(visible.map((c) => c.id))
      const candidates = found
        .filter((c) => visibleIds.has(c.id))
        .map((c) => ({
          id: c.id,
          name: clientName(c),
          phone: maskPhone(c.phone, ctx.role, ctx.instructorsSeePhones),
          funnelStatus: c.funnelStatus,
          clientStatus: c.clientStatus,
          stateLabel: clientStateLabel(c.funnelStatus, c.clientStatus),
        }))
      if (candidates.length === 1) {
        return { match: "phone", clientId: candidates[0].id, candidates, chatId, canonicalChatId: chatId }
      }
      if (candidates.length > 1) {
        return { match: "phone", clientId: null, candidates, chatId, canonicalChatId: chatId }
      }
    }
  }

  // 3. Хендл из карточки. Поля telegram/vk/max люди заполняют свободным текстом,
  // поэтому сравниваем нормализованные значения — сузить выборку в SQL нечем,
  // берём непустые хендлы канала и сверяем в памяти. Их немного: поля новые и
  // заполняются точечно.
  const field = handleFieldForChannel(params.channel)
  if (chatId && field) {
    const withHandle = await db.client.findMany({
      where: {
        tenantId: ctx.tenantId,
        deletedAt: null,
        NOT: { [field]: null },
        ...scope,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        funnelStatus: true,
        clientStatus: true,
        telegram: true,
        vk: true,
        max: true,
      },
      take: 500,
    })
    // Сверяем со всеми идентификаторами чата: в карточке человек вписал
    // «@masha», а каноном стало число — по одному канону совпадение бы
    // потерялось.
    const wanted = new Set(ids.all)
    const matched = withHandle.filter((c) => {
      const handle = normalizeHandle(params.channel, c[field])
      return handle !== null && wanted.has(handle)
    })
    if (matched.length > 0) {
      const candidates = matched.map((c) => ({
        id: c.id,
        name: clientName(c),
        phone: maskPhone(c.phone, ctx.role, ctx.instructorsSeePhones),
        funnelStatus: c.funnelStatus as string,
        clientStatus: c.clientStatus as string | null,
        stateLabel: clientStateLabel(c.funnelStatus, c.clientStatus),
      }))
      return {
        match: "handle",
        clientId: candidates.length === 1 ? candidates[0].id : null,
        candidates,
        chatId,
        canonicalChatId: chatId,
      }
    }
  }

  return empty
}
