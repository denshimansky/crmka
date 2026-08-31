import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { scopeClientByBranch } from "@/lib/client-segments"
import { requireExtAuth } from "@/lib/ext-auth"
import { extJson, extOptions, readExtJson } from "@/lib/ext-cors"
import {
  MESSENGER_CHANNELS,
  handleFieldForChannel,
  isPositiveNumericChatId,
  toPrismaChannel,
} from "@/lib/ext/chat-identity"
import { splitChatIds } from "@/lib/ext/chat-canonical"
import {
  moveCommunicationsOnRebind,
  previousOwnersForChat,
  resolveChatGroup,
} from "@/lib/ext/chat-binding-sync"

/**
 * Привязка чата к клиенту — ядро идентификации панели
 * (docs/messenger-extension.md).
 *
 * Создаётся ЯВНЫМ действием сотрудника: автоматически связывать чат с клиентом
 * по совпадению имени нельзя — цена ошибки высока (чужая переписка и платежи в
 * карточке). Один раз привязали — дальше панель узнаёт собеседника сама.
 */
export const OPTIONS = extOptions

const channelSchema = z.enum(MESSENGER_CHANNELS)

const createSchema = z.object({
  channel: channelSchema,
  chatId: z.string().min(1),
  clientId: z.string().uuid(),
  wardId: z.string().uuid().nullish(),
  displayName: z.string().trim().max(200).nullish(),
  /**
   * Записать идентификатор чата в карточку клиента (поля telegram/vk/max).
   * Полезно: тогда клиент найдётся и с другого устройства, где привязки нет.
   * Существующее значение не затираем — люди вписывают туда ссылки вручную.
   */
  saveHandle: z.boolean().optional(),
  /**
   * Прочие идентификаторы ТОГО ЖЕ чата, увиденные расширением одновременно.
   * Привязку запоминаем под каждым: иначе сделанная в Telegram /k связка не
   * находится в /a, где тот же человек называется числом.
   */
  altIds: z.array(z.string().min(1)).max(4).optional(),
})

const deleteSchema = z.object({
  channel: channelSchema,
  chatId: z.string().min(1),
  altIds: z.array(z.string().min(1)).max(4).optional(),
})

export async function GET(req: NextRequest) {
  const guard = await requireExtAuth(req, "ext.read")
  if (!guard.ok) return guard.response
  const { ctx } = guard

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get("clientId")
  if (!clientId) return extJson(req, { error: "Не указан клиент" }, { status: 400 })

  // Клиент вне филиального scope не существует для этого сотрудника.
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

  const bindings = await db.chatBinding.findMany({
    where: { tenantId: ctx.tenantId, clientId },
    select: {
      id: true,
      channel: true,
      externalChatId: true,
      wardId: true,
      displayName: true,
      lastSeenAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  })

  return extJson(req, { bindings })
}

export async function POST(req: NextRequest) {
  const guard = await requireExtAuth(req, "ext.write")
  if (!guard.ok) return guard.response
  const { ctx } = guard

  // Битое тело больше не даёт 500 без CORS-заголовков (см. readExtJson).
  const body = await readExtJson(req)
  if (body === undefined) {
    return extJson(req, { error: "Ожидался JSON в теле запроса" }, { status: 400 })
  }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return extJson(
      req,
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }
  const { channel, clientId, wardId, displayName, saveHandle } = parsed.data

  const ids = splitChatIds(channel, [parsed.data.chatId, ...(parsed.data.altIds ?? [])])
  if (!ids.canonical) return extJson(req, { error: "Пустой идентификатор чата" }, { status: 400 })

  // Группу разворачиваем по базе: канон, уже закреплённый за этим чатом,
  // важнее канона текущего наблюдения — по нему построены ключи залитых
  // сообщений. Иначе привязка из /a (где @username в разметке нет) разрывала
  // бы группу пополам и чат навсегда уходил в конфликт.
  const group = await resolveChatGroup(ctx.tenantId, channel, ids.all, ids.canonical)
  const chatId = group.canonical
  const groupIds = group.allIds

  const client = await db.client.findFirst({
    where: {
      id: clientId,
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...scopeClientByBranch(ctx.branchScope),
    },
    select: { id: true, telegram: true, vk: true, max: true },
  })
  if (!client) return extJson(req, { error: "Клиент не найден" }, { status: 404 })

  // Подопечный (если указан) должен принадлежать этому же клиенту.
  if (wardId) {
    const ward = await db.ward.findFirst({
      where: { id: wardId, clientId, tenantId: ctx.tenantId },
      select: { id: true },
    })
    if (!ward) return extJson(req, { error: "Подопечный не найден" }, { status: 404 })
  }

  // Кому этот чат принадлежал до сих пор: если другому клиенту, его переписку
  // надо перенести. Иначе ошибочную привязку исправить нельзя в принципе —
  // переписка остаётся у неверного клиента, а верному заливка молча гасится
  // уникальным ключом.
  //
  // Ищем и по живым привязкам, и ПО САМИМ ДАННЫМ: штатное исправление ошибки —
  // «Отвязать → найти нужного → Привязать», а отвязка удаляет привязки
  // физически, и к этому моменту прежнего владельца по ним уже не найти.
  const owners = new Set<string>([
    ...group.rows.map((row) => row.clientId),
    ...(await previousOwnersForChat(ctx.tenantId, channel, groupIds)),
  ])
  owners.delete(clientId)

  // Переносим ТОЛЬКО с клиентов, которых этот сотрудник имеет право видеть.
  // Без этой проверки администратор одного филиала утащил бы себе в карточку
  // переписку клиента другого филиала — того, кого ему видеть не положено.
  const previousClientIds = owners.size
    ? (
        await db.client.findMany({
          where: {
            id: { in: [...owners] },
            tenantId: ctx.tenantId,
            deletedAt: null,
            ...scopeClientByBranch(ctx.branchScope),
          },
          select: { id: true },
        })
      ).map((row) => row.id)
    : []

  // Перепривязка того же чата к другому клиенту — законный сценарий (ошиблись
  // или номер сменил владельца), поэтому upsert, а не отказ по уникальности.
  // Строк заводим столько, сколько идентификаторов: уникальный индекс это
  // разрешает, а сама группа связывается общим canonicalChatId.
  const [binding] = await db.$transaction(
    groupIds.map((externalChatId) =>
      db.chatBinding.upsert({
        where: {
          tenantId_channel_externalChatId: {
            tenantId: ctx.tenantId,
            channel: toPrismaChannel(channel),
            externalChatId,
          },
        },
        create: {
          tenantId: ctx.tenantId,
          channel: toPrismaChannel(channel),
          externalChatId,
          canonicalChatId: chatId,
          clientId,
          wardId: wardId ?? null,
          displayName: displayName ?? null,
          createdBy: ctx.employeeId,
          lastSeenAt: new Date(),
        },
        update: {
          canonicalChatId: chatId,
          clientId,
          wardId: wardId ?? null,
          displayName: displayName ?? null,
          lastSeenAt: new Date(),
        },
        select: { id: true, channel: true, externalChatId: true, clientId: true, wardId: true },
      }),
    ),
  )

  let moved = 0
  for (const from of previousClientIds) {
    moved += await moveCommunicationsOnRebind(ctx.tenantId, channel, from, clientId, groupIds)
  }

  const field = handleFieldForChannel(channel)
  if (saveHandle && field && !client[field]) {
    // В карточку пишем ЧЕЛОВЕКОЧИТАЕМЫЙ идентификатор: «@masha» полезнее
    // администратору, чем числовой peer id. Резолв по хендлу сравнивает
    // нормализованные значения и работает с любым из них.
    const readable = groupIds.find((id) => !isPositiveNumericChatId(id)) ?? chatId
    await db.client.update({ where: { id: clientId }, data: { [field]: readable } })
  }

  return extJson(req, { binding, moved }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const guard = await requireExtAuth(req, "ext.write")
  if (!guard.ok) return guard.response
  const { ctx } = guard

  // Битое тело больше не даёт 500 без CORS-заголовков (см. readExtJson).
  const body = await readExtJson(req)
  if (body === undefined) {
    return extJson(req, { error: "Ожидался JSON в теле запроса" }, { status: 400 })
  }
  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) return extJson(req, { error: "Не указан чат" }, { status: 400 })

  const ids = splitChatIds(parsed.data.channel, [
    parsed.data.chatId,
    ...(parsed.data.altIds ?? []),
  ])
  if (!ids.canonical) return extJson(req, { error: "Пустой идентификатор чата" }, { status: 400 })

  // Разворачиваем группу по базе: если числовой peer id в этот момент не
  // прочитался, наивная чистка сняла бы одну строку из двух — и чат остался
  // бы привязанным в другом клиенте Telegram.
  const group = await resolveChatGroup(
    ctx.tenantId,
    parsed.data.channel,
    ids.all,
    ids.canonical,
  )
  const binding = group.rows[0]
  if (!binding) return extJson(req, { error: "Привязка не найдена" }, { status: 404 })

  // Отвязывать может только тот, кто видит клиента.
  const client = await db.client.findFirst({
    where: {
      id: binding.clientId,
      tenantId: ctx.tenantId,
      ...scopeClientByBranch(ctx.branchScope),
    },
    select: { id: true },
  })
  if (!client) return extJson(req, { error: "Привязка не найдена" }, { status: 404 })

  // Снимаем всю группу идентификаторов этого чата и строго в пределах ОДНОГО
  // клиента: иначе «отвязал в /a, а в /k всё ещё привязано».
  await db.chatBinding.deleteMany({
    where: {
      tenantId: ctx.tenantId,
      channel: toPrismaChannel(parsed.data.channel),
      clientId: binding.clientId,
      OR: [
        { externalChatId: { in: group.allIds } },
        { canonicalChatId: { in: group.allIds } },
      ],
    },
  })
  return extJson(req, { ok: true })
}
