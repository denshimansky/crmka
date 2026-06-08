import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { logAudit } from "@/lib/audit"
import { rateLimitTenant } from "@/lib/rate-limit"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { z } from "zod"

// Редактирование «обычной» оплаты на случай ошибки админа.
// Доступно только владельцу и управляющему. Возвраты, переводы и прочие
// служебные движения через этот эндпоинт не меняются.
const updateSchema = z.object({
  amount: z.number().min(0.01, "Сумма должна быть больше 0").optional(),
  method: z
    .enum([
      "cash",
      "bank_transfer",
      "acquiring",
      "online_yukassa",
      "online_robokassa",
      "sbp_qr",
    ])
    .optional(),
  date: z.string().min(1).optional(),
  accountId: z.string().uuid().optional(),
  comment: z.any().transform(v =>
    v === undefined
      ? undefined
      : typeof v === "string" && v.trim()
        ? v.trim()
        : null,
  ),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json(
      { error: "Редактировать оплаты могут только владелец и управляющий" },
      { status: 403 },
    )
  }

  const rl = rateLimitTenant(session.user.tenantId)
  if (!rl.ok) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }
  const data = parsed.data

  const existing = await db.payment.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!existing) {
    return NextResponse.json({ error: "Оплата не найдена" }, { status: 404 })
  }

  // Редактирование разрешено только для обычных «входящих» оплат.
  // Возвраты делаются через отдельный диалог; внутренние movements (переводы,
  // pay-from-balance) — отдельной операцией.
  if (existing.type !== "incoming") {
    return NextResponse.json(
      { error: "Этот тип операции нельзя редактировать здесь" },
      { status: 400 },
    )
  }

  const newDate = data.date ? new Date(data.date) : existing.date
  // Запрещаем «вытаскивать» из закрытого периода и «класть» в закрытый.
  if (await isPeriodLocked(session.user.tenantId, existing.date, role)) {
    return NextResponse.json(
      { error: "Исходная дата оплаты попадает в закрытый период" },
      { status: 403 },
    )
  }
  if (
    data.date &&
    (await isPeriodLocked(session.user.tenantId, newDate, role))
  ) {
    return NextResponse.json(
      { error: "Новая дата попадает в закрытый период" },
      { status: 403 },
    )
  }

  const newAmount = data.amount ?? Number(existing.amount)
  const oldAmount = Number(existing.amount)
  const newAccountId = data.accountId ?? existing.accountId

  // Проверка нового счёта.
  if (data.accountId && data.accountId !== existing.accountId) {
    const account = await db.financialAccount.findFirst({
      where: {
        id: data.accountId,
        tenantId: session.user.tenantId,
        deletedAt: null,
      },
    })
    if (!account) {
      return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })
    }
  }

  const updated = await db.$transaction(async (tx) => {
    // Балансы счетов: списываем со старого, начисляем на новый.
    if (newAccountId !== existing.accountId) {
      await tx.financialAccount.update({
        where: { id: existing.accountId },
        data: { balance: { decrement: oldAmount } },
      })
      await tx.financialAccount.update({
        where: { id: newAccountId },
        data: { balance: { increment: newAmount } },
      })
    } else if (newAmount !== oldAmount) {
      await tx.financialAccount.update({
        where: { id: existing.accountId },
        data: { balance: { increment: newAmount - oldAmount } },
      })
    }

    // Баланс родителя — только если у оплаты есть клиент (не «прочий доход»)
    // и сумма поменялась.
    if (existing.clientId && newAmount !== oldAmount) {
      await applyBalanceDelta(tx, {
        tenantId: session.user.tenantId,
        clientId: existing.clientId,
        delta: newAmount - oldAmount,
        type: "correction",
        refs: { paymentId: existing.id },
        comment: "Корректировка оплаты",
        createdBy: session.user.employeeId,
      })
    }

    return tx.payment.update({
      where: { id },
      data: {
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.method !== undefined && { method: data.method }),
        ...(data.date !== undefined && { date: newDate }),
        ...(data.accountId !== undefined && { accountId: data.accountId }),
        ...(data.comment !== undefined && { comment: data.comment }),
      },
      include: {
        client: { select: { id: true, firstName: true, lastName: true } },
        account: { select: { id: true, name: true } },
      },
    })
  })

  logAudit({
    tenantId: session.user.tenantId,
    employeeId: session.user.employeeId,
    action: "update",
    entityType: "Payment",
    entityId: id,
    changes: {
      ...(data.amount !== undefined && {
        amount: { old: oldAmount, new: data.amount },
      }),
      ...(data.method !== undefined && {
        method: { old: existing.method, new: data.method },
      }),
      ...(data.date !== undefined && {
        date: { old: existing.date, new: newDate },
      }),
      ...(data.accountId !== undefined && {
        accountId: { old: existing.accountId, new: data.accountId },
      }),
      ...(data.comment !== undefined && {
        comment: { old: existing.comment, new: data.comment },
      }),
    },
    req,
  })

  return NextResponse.json(updated)
}
