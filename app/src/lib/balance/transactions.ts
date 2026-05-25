import { Prisma, type PrismaClient, type BalanceTransactionType } from "@prisma/client"

type DB = PrismaClient | Prisma.TransactionClient

export interface BalanceDeltaRefs {
  subscriptionId?: string | null
  paymentId?: string | null
  lessonId?: string | null
  directionId?: string | null
  attendanceId?: string | null
}

export interface BalanceDeltaInput {
  tenantId: string
  clientId: string
  delta: Prisma.Decimal | number | string
  type: BalanceTransactionType
  refs?: BalanceDeltaRefs
  comment?: string
  createdBy?: string | null
}

export interface BalanceDeltaResult {
  newBalance: Prisma.Decimal
  transactionId: string
}

/**
 * Единая точка мутации Client.clientBalance.
 *
 * Атомарно увеличивает/уменьшает баланс клиента и пишет запись в
 * ClientBalanceTransaction со снапшотом balanceAfter и ссылками на источник
 * (subscription/payment/lesson/attendance).
 *
 * Все новые места, меняющие clientBalance, ОБЯЗАНЫ использовать эту функцию.
 * Прямые `prisma.client.update({ clientBalance: ... })` запрещены.
 */
export async function applyBalanceDelta(
  db: DB,
  input: BalanceDeltaInput
): Promise<BalanceDeltaResult> {
  const delta = new Prisma.Decimal(input.delta)

  const updated = await db.client.update({
    where: { id: input.clientId },
    data: { clientBalance: { increment: delta } },
    select: { clientBalance: true },
  })

  const tx = await db.clientBalanceTransaction.create({
    data: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      type: input.type,
      amount: delta,
      balanceAfter: updated.clientBalance,
      subscriptionId: input.refs?.subscriptionId ?? null,
      paymentId: input.refs?.paymentId ?? null,
      lessonId: input.refs?.lessonId ?? null,
      directionId: input.refs?.directionId ?? null,
      attendanceId: input.refs?.attendanceId ?? null,
      comment: input.comment,
      createdBy: input.createdBy ?? null,
    },
    select: { id: true },
  })

  return { newBalance: updated.clientBalance, transactionId: tx.id }
}
