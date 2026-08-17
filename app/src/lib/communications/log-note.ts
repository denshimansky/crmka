import type { Prisma, PrismaClient } from "@prisma/client"

type Tx = Prisma.TransactionClient | PrismaClient

/**
 * Пишет внутреннюю заметку (type=note) в ленту коммуникаций клиента — единая
 * точка для «событий-комментариев»: правка общего комментария клиента, а также
 * комментарии к оплатам, возвратам, пробным и заявкам. Формат в фиде за счёт
 * этого одинаковый (как у заметки отчисления в subscriptions/[id]).
 *
 * Пустой content игнорируется (пустая заметка бессмысленна). Передавайте tx,
 * когда важна атомарность с основной мутацией (правка Client.comment), иначе db.
 */
export async function logClientNote(
  tx: Tx,
  params: {
    tenantId: string
    clientId: string
    content: string
    employeeId?: string | null
  },
): Promise<void> {
  const content = params.content.trim()
  if (!content) return
  await tx.communication.create({
    data: {
      tenantId: params.tenantId,
      clientId: params.clientId,
      type: "note",
      channel: "internal",
      direction: "internal",
      content,
      employeeId: params.employeeId || undefined,
    },
  })
}

/**
 * Логирует в ленту клиента добавление нового подопечного — «кто и когда» берётся
 * из employeeId и created_at заметки. Единый формат для ручного добавления в
 * карточке (POST /api/clients/[id]/wards) и создания клиента с детьми
 * (POST /api/clients). Импорт базы намеренно НЕ логируем — это массовая
 * системная заливка, а не действие сотрудника «завёл подопечного».
 */
export async function logWardAdded(
  tx: Tx,
  params: {
    tenantId: string
    clientId: string
    ward: { firstName: string; lastName?: string | null; birthDate?: Date | null }
    employeeId?: string | null
  },
): Promise<void> {
  const name =
    [params.ward.lastName, params.ward.firstName].filter(Boolean).join(" ").trim() ||
    "(без имени)"
  // Дату рождения форматируем из UTC-частей: birthDate хранится как @db.Date
  // (полночь UTC), а toLocaleDateString в TZ сервера может сдвинуть день.
  let suffix = ""
  const bd = params.ward.birthDate
  if (bd) {
    const dd = String(bd.getUTCDate()).padStart(2, "0")
    const mm = String(bd.getUTCMonth() + 1).padStart(2, "0")
    suffix = `, д.р. ${dd}.${mm}.${bd.getUTCFullYear()}`
  }
  await logClientNote(tx, {
    tenantId: params.tenantId,
    clientId: params.clientId,
    content: `Добавлен подопечный: ${name}${suffix}`,
    employeeId: params.employeeId,
  })
}
