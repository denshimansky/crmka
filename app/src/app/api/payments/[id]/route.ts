import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { logAudit } from "@/lib/audit"
import { rateLimitTenant } from "@/lib/rate-limit"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { logClientNote } from "@/lib/communications/log-note"
import { requirePermission } from "@/lib/api-permissions"
import { branchScopeFromSession, scopePayment } from "@/lib/branch-scope"
import { currencySymbol } from "@/lib/currency"
import { z } from "zod"
import { Prisma } from "@prisma/client"

// Ошибка «на балансе не хватает» — деньги уже потрачены, откатывать нечего.
class InsufficientBalanceError extends Error {
  constructor(public balance: number, public amount: number) {
    super("insufficient_balance")
  }
}

function fmtMoney(n: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU").format(n) + " " + currencySymbol(currency)
}

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
  // «Не учитывать в ОПИУ» — применяется только к прочему доходу (баг #105).
  notInPnl: z.boolean().optional(),
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

  const currency =
    (
      await db.organization.findUnique({
        where: { id: session.user.tenantId },
        select: { currency: true },
      })
    )?.currency ?? "RUB"

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

  let updated
  try {
    updated = await db.$transaction(async (tx) => {
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
      const { newBalance } = await applyBalanceDelta(tx, {
        tenantId: session.user.tenantId,
        clientId: existing.clientId,
        delta: newAmount - oldAmount,
        type: "correction",
        refs: { paymentId: existing.id },
        comment: "Корректировка оплаты",
        createdBy: session.user.employeeId,
      })
      // Уменьшение суммы не должно уводить баланс клиента в минус: деньги уже
      // потрачены (списаны в абонемент и т.п.) — сначала верните их на баланс.
      if (newBalance.lt(0)) {
        throw new InsufficientBalanceError(
          Number(newBalance.add(new Prisma.Decimal(oldAmount - newAmount))),
          oldAmount - newAmount,
        )
      }
    }

    const updatedRow = await tx.payment.update({
      where: { id },
      data: {
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.method !== undefined && { method: data.method }),
        ...(data.date !== undefined && { date: newDate }),
        ...(data.accountId !== undefined && { accountId: data.accountId }),
        ...(data.comment !== undefined && { comment: data.comment }),
        // Флаг ОПИУ применяем только к прочему доходу (у оплаты клиента он
        // бессмыслен — в ОПИУ она и так не попадает).
        ...(data.notInPnl !== undefined && existing.incomeCategoryId != null && {
          notInPnl: data.notInPnl,
        }),
      },
      include: {
        client: { select: { id: true, firstName: true, lastName: true } },
        account: { select: { id: true, name: true } },
      },
    })

    // Правка комментария оплаты клиента → заметка в ленту коммуникаций (баг #117):
    // «откуда» (оплата + сумма/дата), «когда» (createdAt), «кто» (employeeId).
    // Прочий доход (без clientId) ленты не имеет.
    if (existing.clientId && data.comment !== undefined) {
      const oldC = existing.comment?.trim() || ""
      const newC = (data.comment ?? "").trim()
      if (oldC !== newC) {
        const ref = `оплате ${fmtMoney(newAmount, currency)} от ${newDate.toLocaleDateString("ru-RU")}`
        const content = !oldC
          ? `Комментарий к ${ref} добавлен:\n${newC}`
          : !newC
            ? `Комментарий к ${ref} удалён:\n«${oldC}»`
            : `Комментарий к ${ref} изменён:\n«${oldC}»\n→ «${newC}»`
        await logClientNote(tx, {
          tenantId: session.user.tenantId,
          clientId: existing.clientId,
          content,
          employeeId: session.user.employeeId,
        })
      }
    }
    return updatedRow
    })
  } catch (e) {
    if (e instanceof InsufficientBalanceError) {
      return NextResponse.json(
        {
          error:
            `Нельзя уменьшить сумму: на балансе клиента ${fmtMoney(e.balance, currency)}, а уменьшение — на ${fmtMoney(e.amount, currency)}. ` +
            `Деньги уже потрачены — например, списаны в счёт абонемента. ` +
            `Отчислите абонемент с возвратом денег на баланс или откройте карточку клиента → вкладка «История» и проверьте, куда ушли средства.`,
        },
        { status: 400 },
      )
    }
    throw e
  }

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
      ...(data.notInPnl !== undefined && existing.incomeCategoryId != null && {
        notInPnl: { old: existing.notInPnl, new: data.notInPnl },
      }),
    },
    req,
  })

  return NextResponse.json(updated)
}

// DELETE /api/payments/[id] — удалить операцию оплаты с откатом пополнения.
// Право payments.delete: владелец всегда; управляющему владелец может включить
// в матрице прав. Удаляются только обычные входящие оплаты (не возвраты и не
// служебные движения). Пополнение откатывается со счёта и с баланса родителя;
// если деньги с баланса уже потрачены (списаны в абонемент и т.п.) — отказ.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePermission("payments.delete")
  if (!guard.ok) return guard.response
  const session = guard.session as any

  const rl = rateLimitTenant(session.user.tenantId)
  if (!rl.ok) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 })
  }

  const { id } = await params
  const tenantId = session.user.tenantId as string
  const role = session.user.role

  // ADM-04: филиально-ограниченная роль не удаляет оплаты чужого филиала
  // (страница и так скоупит выборку — защищаем прямой запрос к API).
  const allowedBranchIds = (session.user as any).allowedBranchIds as string[] | null | undefined
  const branchScope = branchScopeFromSession(allowedBranchIds)
  const scopeFilter = scopePayment(branchScope)

  const existing = await db.payment.findFirst({
    where: {
      ...(Object.keys(scopeFilter).length > 0
        ? { AND: [{ id, tenantId, deletedAt: null }, scopeFilter] }
        : { id, tenantId, deletedAt: null }),
    },
    include: { client: { select: { id: true, firstName: true, lastName: true } } },
  })
  if (!existing) {
    return NextResponse.json({ error: "Оплата не найдена" }, { status: 404 })
  }

  if (existing.type !== "incoming") {
    return NextResponse.json(
      { error: "Удалять можно только обычные оплаты. Возвраты и служебные операции не удаляются." },
      { status: 400 },
    )
  }

  const currency =
    (
      await db.organization.findUnique({
        where: { id: tenantId },
        select: { currency: true },
      })
    )?.currency ?? "RUB"

  // Онлайн-оплата привязана к реальному платежу в эквайринге: удаление в CRM
  // денег плательщику не вернёт, а повторное уведомление ЮKassa воссоздало бы
  // запись. Правильный путь — возврат.
  if (existing.onlinePaymentId) {
    return NextResponse.json(
      { error: "Онлайн-оплату нельзя удалить: деньги прошли через платёжную систему. Оформите возврат кнопкой «Возврат»." },
      { status: 400 },
    )
  }

  if (await isPeriodLocked(tenantId, existing.date, role)) {
    return NextResponse.json(
      { error: "Дата оплаты попадает в закрытый период" },
      { status: 403 },
    )
  }

  const amount = Number(existing.amount)

  try {
    await db.$transaction(async (tx) => {
      // Откат с баланса родителя (для «прочих доходов» клиента нет).
      // Сначала применяем дельту, затем проверяем итог: атомарно защищает от
      // ухода в минус при параллельных списаниях.
      if (existing.clientId) {
        const { newBalance } = await applyBalanceDelta(tx, {
          tenantId,
          clientId: existing.clientId,
          delta: -amount,
          type: "correction",
          refs: { paymentId: existing.id },
          comment: `Удаление оплаты от ${existing.date.toLocaleDateString("ru-RU")}`,
          createdBy: session.user.employeeId,
        })
        if (newBalance.lt(0)) {
          throw new InsufficientBalanceError(
            Number(newBalance.add(new Prisma.Decimal(amount))),
            amount,
          )
        }
      }

      // Откат поступления со счёта.
      await tx.financialAccount.update({
        where: { id: existing.accountId },
        data: { balance: { decrement: amount } },
      })

      await tx.payment.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      })

      // Откат побочных эффектов «первой оплаты» (POST ставил firstPaymentDate/
      // saleDate/isFirstPayment). Пересчитываем по самой ранней из оставшихся
      // оплат; если оплат не осталось — даты обнуляются. funnelStatus не
      // трогаем: переход «клиент → лид» по архитектуре невозможен, статус
      // при необходимости меняется вручную в карточке.
      if (existing.clientId && existing.isFirstPayment) {
        const earliest = await tx.payment.findFirst({
          where: { tenantId, clientId: existing.clientId, deletedAt: null, type: "incoming" },
          orderBy: { date: "asc" },
          select: { id: true, date: true },
        })
        if (earliest) {
          await tx.payment.update({
            where: { id: earliest.id },
            data: { isFirstPayment: true },
          })
        }
        await tx.client.update({
          where: { id: existing.clientId },
          data: {
            firstPaymentDate: earliest?.date ?? null,
            saleDate: earliest?.date ?? null,
          },
        })
      }
    })
  } catch (e) {
    if (e instanceof InsufficientBalanceError) {
      return NextResponse.json(
        {
          error:
            `Нельзя удалить оплату: на балансе клиента ${fmtMoney(e.balance, currency)}, а оплата — на ${fmtMoney(e.amount, currency)}. ` +
            `Деньги уже потрачены — например, списаны в счёт абонемента. ` +
            `Отчислите абонемент с возвратом денег на баланс или откройте карточку клиента → вкладка «История» и проверьте, куда ушли средства.`,
        },
        { status: 400 },
      )
    }
    throw e
  }

  logAudit({
    tenantId,
    employeeId: session.user.employeeId,
    action: "delete",
    entityType: "Payment",
    entityId: id,
    changes: {
      amount: { old: amount },
      method: { old: existing.method },
      clientId: { old: existing.clientId ?? null },
      date: { old: existing.date },
    },
    req,
  })

  return NextResponse.json({ ok: true })
}
