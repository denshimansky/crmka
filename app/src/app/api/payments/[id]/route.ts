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

// Ошибка «на балансе не хватает». Для обычной оплаты — деньги уже потрачены,
// откатывать нечего; для возврата — нельзя вернуть больше, чем лежит на балансе.
class InsufficientBalanceError extends Error {
  constructor(
    public balance: number,
    public amount: number,
    public isRefund = false,
  ) {
    super("insufficient_balance")
  }
}

// Возврат (или увеличение возврата) не должен увести счёт списания в минус —
// как проверка «Недостаточно средств на счёте» при создании возврата.
class AccountOverdrawError extends Error {
  constructor(public accountName: string, public deficit: number) {
    super("account_overdraw")
  }
}

function fmtMoney(n: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU").format(n) + " " + currencySymbol(currency)
}

// Редактирование оплаты или возврата на случай ошибки админа. Доступно только
// владельцу и управляющему. Переводы и прочие служебные движения (transfer_in)
// через этот эндпоинт не меняются. Для возврата сумма приходит положительной
// (величина возврата), знак проставляется на сервере по типу операции.
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

  // Редактируем обычные оплаты и возвраты. Внутренние movements (переводы,
  // pay-from-balance = transfer_in) правятся отдельной операцией.
  const isRefund = existing.type === "refund"
  if (existing.type !== "incoming" && !isRefund) {
    return NextResponse.json(
      { error: "Этот тип операции нельзя редактировать здесь" },
      { status: 400 },
    )
  }

  // Историческая аномалия: несколько старых возвратов привязаны к абонементу
  // (subscriptionId). netPaidToSubscription читает такие возвраты вживую, а сверка
  // закрытия (subscription_closed_refund) заморожена на момент закрытия — правка
  // суммы разъедет «Оплачено» закрытого абонемента. Новые возвраты всегда с
  // subscriptionId=null, поэтому штатный сценарий это не затрагивает.
  if (isRefund && existing.subscriptionId) {
    return NextResponse.json(
      {
        error:
          "Этот возврат привязан к абонементу (старая запись) — его правка исказит " +
          "«Оплачено» абонемента. Обратитесь к разработчику.",
      },
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

  // Знаковые суммы: у возврата запись хранится с минусом, а из диалога приходит
  // положительная величина — знак проставляем по типу операции. И счёт, и баланс
  // родителя всегда двигаются на знаковую amount (incoming +, refund −), поэтому
  // вся арифметика ниже единообразна для обоих типов.
  const oldAmount = Number(existing.amount)
  const newAmount =
    data.amount !== undefined ? (isRefund ? -data.amount : data.amount) : oldAmount
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

    // Возврат не должен увести счёт списания в минус — как проверка «Недостаточно
    // средств на счёте» при создании возврата. Проверяем ТОЛЬКО когда правка
    // реально списывает со счёта больше (увеличение возврата или перенос на другой
    // счёт): уменьшение возврата счёт лишь пополняет и в минус увести не может,
    // поэтому не блокируем правки при уже отрицательном (по иным причинам) счёте.
    const accountChanged = newAccountId !== existing.accountId
    const netToNewAccount = accountChanged ? newAmount : newAmount - oldAmount
    if (isRefund && netToNewAccount < 0) {
      const acct = await tx.financialAccount.findUnique({
        where: { id: newAccountId },
        select: { name: true, balance: true },
      })
      if (acct && new Prisma.Decimal(acct.balance).lt(0)) {
        throw new AccountOverdrawError(
          acct.name,
          Number(new Prisma.Decimal(acct.balance).negated()),
        )
      }
    }

    // Баланс родителя — только если у операции есть клиент (не «прочий доход»)
    // и знаковая сумма поменялась.
    const clientDelta = newAmount - oldAmount
    if (existing.clientId && clientDelta !== 0) {
      const { newBalance } = await applyBalanceDelta(tx, {
        tenantId: session.user.tenantId,
        clientId: existing.clientId,
        delta: clientDelta,
        type: "correction",
        refs: { paymentId: existing.id },
        comment: isRefund ? "Корректировка возврата" : "Корректировка оплаты",
        createdBy: session.user.employeeId,
      })
      // В минус баланс уводить нельзя ТОЛЬКО когда операция его уменьшает
      // (clientDelta < 0): уменьшение обычной оплаты или увеличение возврата.
      // Обратные правки (увеличение оплаты / уменьшение возврата) баланс растят —
      // блокировать их нельзя, даже если клиент и так в минусе.
      if (clientDelta < 0 && newBalance.lt(0)) {
        throw new InsufficientBalanceError(
          Number(newBalance.sub(new Prisma.Decimal(clientDelta))),
          Number(newBalance.negated()),
          isRefund,
        )
      }
    }

    const updatedRow = await tx.payment.update({
      where: { id },
      data: {
        ...(data.amount !== undefined && { amount: newAmount }),
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
        const ref = `${isRefund ? "возврату" : "оплате"} ${fmtMoney(Math.abs(newAmount), currency)} от ${newDate.toLocaleDateString("ru-RU")}`
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
    if (e instanceof AccountOverdrawError) {
      return NextResponse.json(
        {
          error:
            `Недостаточно средств на счёте «${e.accountName}» для возврата: не хватает ${fmtMoney(e.deficit, currency)}. ` +
            `Уменьшите сумму возврата или выберите другой счёт списания.`,
        },
        { status: 400 },
      )
    }
    if (e instanceof InsufficientBalanceError) {
      return NextResponse.json(
        {
          error: e.isRefund
            ? `Нельзя увеличить возврат: на балансе клиента ${fmtMoney(e.balance, currency)}, для возврата не хватает ${fmtMoney(e.amount, currency)}. ` +
              `Деньги, перенесённые в абонемент, на балансе не лежат — сначала верните их на баланс (отчисление/закрытие абонемента или перенос остатка).`
            : `Нельзя уменьшить сумму: на балансе клиента ${fmtMoney(e.balance, currency)}, не хватает ${fmtMoney(e.amount, currency)}. ` +
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
        amount: { old: oldAmount, new: newAmount },
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

// DELETE /api/payments/[id] — удалить оплату или возврат с полным откатом.
// Право payments.delete: владелец всегда; управляющему владелец может включить
// в матрице прав. Удаляются обычные входящие оплаты и возвраты (не служебные
// transfer_in). И счёт, и баланс родителя двигаются на знаковую amount, поэтому
// откат — вычитание этой суммы: для оплаты деньги снимаются (и, если уже
// потрачены с баланса, — отказ), для возврата возвращаются на счёт и баланс.
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

  const isRefund = existing.type === "refund"
  if (existing.type !== "incoming" && !isRefund) {
    return NextResponse.json(
      { error: "Удалять можно только оплаты и возвраты. Служебные операции (переводы) не удаляются." },
      { status: 400 },
    )
  }

  // Историческая аномалия: несколько старых возвратов привязаны к абонементу
  // (subscriptionId). Их soft-delete меняет живой netPaid, а замороженная сверка
  // закрытия (subscription_closed_refund) — нет, из-за чего «Оплачено» закрытого
  // абонемента показало бы переплату. Новые возвраты с subscriptionId=null.
  if (isRefund && existing.subscriptionId) {
    return NextResponse.json(
      {
        error:
          "Этот возврат привязан к абонементу (старая запись) — его удаление исказит " +
          "«Оплачено» абонемента. Обратитесь к разработчику.",
      },
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
          comment: `${isRefund ? "Удаление возврата" : "Удаление оплаты"} от ${existing.date.toLocaleDateString("ru-RU")}`,
          createdBy: session.user.employeeId,
        })
        // Баланс уходит вниз только при удалении обычной оплаты (amount > 0):
        // тогда нельзя увести его в минус — деньги уже потрачены. Удаление
        // возврата (amount < 0) баланс поднимает — не блокируем.
        if (amount > 0 && newBalance.lt(0)) {
          throw new InsufficientBalanceError(
            Number(newBalance.add(new Prisma.Decimal(amount))),
            amount,
          )
        }
      }

      // Откат движения по счёту (знаковая amount: оплату снимаем со счёта,
      // возврат — возвращаем на счёт).
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
