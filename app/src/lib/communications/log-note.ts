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
