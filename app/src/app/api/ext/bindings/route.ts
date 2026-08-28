import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { scopeClientByBranch } from "@/lib/client-segments"
import { requireExtAuth } from "@/lib/ext-auth"
import { extJson, extOptions } from "@/lib/ext-cors"
import {
  MESSENGER_CHANNELS,
  handleFieldForChannel,
  normalizeChatId,
  toPrismaChannel,
} from "@/lib/ext/chat-identity"

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
})

const deleteSchema = z.object({
  channel: channelSchema,
  chatId: z.string().min(1),
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

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return extJson(
      req,
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }
  const { channel, clientId, wardId, displayName, saveHandle } = parsed.data

  const chatId = normalizeChatId(channel, parsed.data.chatId)
  if (!chatId) return extJson(req, { error: "Пустой идентификатор чата" }, { status: 400 })

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

  // Перепривязка того же чата к другому клиенту — законный сценарий (ошиблись
  // или номер сменил владельца), поэтому upsert, а не отказ по уникальности.
  const binding = await db.chatBinding.upsert({
    where: {
      tenantId_channel_externalChatId: {
        tenantId: ctx.tenantId,
        channel: toPrismaChannel(channel),
        externalChatId: chatId,
      },
    },
    create: {
      tenantId: ctx.tenantId,
      channel: toPrismaChannel(channel),
      externalChatId: chatId,
      clientId,
      wardId: wardId ?? null,
      displayName: displayName ?? null,
      createdBy: ctx.employeeId,
      lastSeenAt: new Date(),
    },
    update: {
      clientId,
      wardId: wardId ?? null,
      displayName: displayName ?? null,
      lastSeenAt: new Date(),
    },
    select: { id: true, channel: true, externalChatId: true, clientId: true, wardId: true },
  })

  const field = handleFieldForChannel(channel)
  if (saveHandle && field && !client[field]) {
    await db.client.update({ where: { id: clientId }, data: { [field]: chatId } })
  }

  return extJson(req, { binding }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const guard = await requireExtAuth(req, "ext.write")
  if (!guard.ok) return guard.response
  const { ctx } = guard

  const parsed = deleteSchema.safeParse(await req.json())
  if (!parsed.success) return extJson(req, { error: "Не указан чат" }, { status: 400 })

  const chatId = normalizeChatId(parsed.data.channel, parsed.data.chatId)
  if (!chatId) return extJson(req, { error: "Пустой идентификатор чата" }, { status: 400 })

  const binding = await db.chatBinding.findUnique({
    where: {
      tenantId_channel_externalChatId: {
        tenantId: ctx.tenantId,
        channel: toPrismaChannel(parsed.data.channel),
        externalChatId: chatId,
      },
    },
    select: { id: true, clientId: true },
  })
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

  await db.chatBinding.delete({ where: { id: binding.id } })
  return extJson(req, { ok: true })
}
