import { db } from "@/lib/db"
import { findClientsByPhone } from "@/lib/clients/find-by-phone"
import { scopeClientByBranch } from "@/lib/client-segments"
import { clientStateLabel } from "@/lib/clients/state-label"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import type { ExtContext } from "@/lib/ext-auth"
import {
  handleFieldForChannel,
  normalizeChatId,
  normalizeHandle,
  toPrismaChannel,
  type MessengerChannel,
} from "@/lib/ext/chat-identity"

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

export type ExtResolveMatch = "binding" | "phone" | "handle" | "none"

export interface ExtResolveResult {
  match: ExtResolveMatch
  /** Заполнено, когда клиент определён однозначно. */
  clientId: string | null
  /** Кандидаты для ручного выбора, когда однозначности нет. */
  candidates: ExtClientCandidate[]
  /** Нормализованный id чата — его же расширение шлёт при привязке. */
  chatId: string | null
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
  params: { channel: MessengerChannel; chatId?: string | null; phone?: string | null },
): Promise<ExtResolveResult> {
  const chatId = normalizeChatId(params.channel, params.chatId)
  const scope = scopeClientByBranch(ctx.branchScope)
  const empty: ExtResolveResult = { match: "none", clientId: null, candidates: [], chatId }

  // 1. Готовая привязка. Проверяем, что клиент всё ещё виден этому сотруднику:
  // привязку мог сделать коллега с доступом к другому филиалу.
  if (chatId) {
    const binding = await db.chatBinding.findUnique({
      where: {
        tenantId_channel_externalChatId: {
          tenantId: ctx.tenantId,
          channel: toPrismaChannel(params.channel),
          externalChatId: chatId,
        },
      },
      select: { clientId: true },
    })
    if (binding) {
      const visible = await db.client.findFirst({
        where: { id: binding.clientId, tenantId: ctx.tenantId, deletedAt: null, ...scope },
        select: { id: true },
      })
      if (visible) {
        // Отметка «чат виден сейчас» — по ней в CRM видно живые привязки.
        void db.chatBinding
          .update({
            where: {
              tenantId_channel_externalChatId: {
                tenantId: ctx.tenantId,
                channel: toPrismaChannel(params.channel),
                externalChatId: chatId,
              },
            },
            data: { lastSeenAt: new Date() },
          })
          .catch(() => {})
        return { match: "binding", clientId: binding.clientId, candidates: [], chatId }
      }
    }
  }

  // 2. Телефон. Для WhatsApp/MAX нормализованный chatId — это уже ключ номера
  // (последние 10 цифр), тот же, что использует findClientsByPhone.
  const phoneInput =
    params.phone ??
    (params.channel === "whatsapp" || params.channel === "max"
      ? chatId && !chatId.startsWith("lid:")
        ? chatId
        : null
      : null)

  if (phoneInput) {
    const found = await findClientsByPhone(db, ctx.tenantId, phoneInput, { limit: 5 })
    if (found.length > 0) {
      // Филиальный scope findClientsByPhone не применяет (это обязанность
      // вызывающего) — досеиваем сами.
      const ids = found.map((c) => c.id)
      const visible = await db.client.findMany({
        where: { id: { in: ids }, tenantId: ctx.tenantId, deletedAt: null, ...scope },
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
        return { match: "phone", clientId: candidates[0].id, candidates, chatId }
      }
      if (candidates.length > 1) {
        return { match: "phone", clientId: null, candidates, chatId }
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
    const matched = withHandle.filter(
      (c) => normalizeHandle(params.channel, c[field]) === chatId,
    )
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
      }
    }
  }

  return empty
}
