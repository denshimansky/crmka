import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  expenseAmountInWindow,
  AMORTIZATION_LOOKBACK_MONTHS,
} from "@/lib/expense-amortization"

function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Наличные",
  bank_transfer: "Безнал",
  acquiring: "Эквайринг",
  online_yukassa: "ЮKassa",
  online_robokassa: "Робокасса",
  sbp_qr: "СБП",
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = (session.user as any).tenantId
  const { searchParams } = new URL(req.url)

  const report = searchParams.get("report")
  const field = searchParams.get("field")
  const monthParam = searchParams.get("month")
  const branchId = searchParams.get("branchId")
  const categoryId = searchParams.get("categoryId")
  const incomeCategoryId = searchParams.get("incomeCategoryId")

  if (!report || !field || !monthParam) {
    return NextResponse.json({ error: "Missing params: report, field, month" }, { status: 400 })
  }

  const [yearStr, monthStr] = monthParam.split("-")
  const year = Number(yearStr)
  const month = Number(monthStr)
  if (!year || !month) {
    return NextResponse.json({ error: "Invalid month format" }, { status: 400 })
  }

  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

  try {
    let columns: string[] = []
    let rows: (string | number)[][] = []

    if (field === "revenue") {
      // Детализация выручки — список посещений с суммами.
      const attWhere: any = {
        tenantId,
        lesson: { date: { gte: monthStart, lte: monthEnd } },
        attendanceType: { countsAsRevenue: true },
      }
      if (branchId) attWhere.lesson = { ...attWhere.lesson, group: { branchId } }

      const attendances = await db.attendance.findMany({
        where: attWhere,
        select: {
          chargeAmount: true,
          lesson: {
            select: {
              date: true,
              group: { select: { name: true } },
            },
          },
          subscription: {
            select: {
              client: { select: { firstName: true, lastName: true } },
              direction: { select: { name: true } },
            },
          },
        },
        orderBy: { lesson: { date: "desc" } },
        take: 500,
      })

      columns = ["Дата", "Направление", "Группа", "Ученик", "Сумма"]
      rows = attendances.map((a) => {
        const clientName = a.subscription?.client
          ? [a.subscription.client.lastName, a.subscription.client.firstName].filter(Boolean).join(" ")
          : "—"
        return [
          formatDate(a.lesson.date),
          a.subscription?.direction.name ?? "—",
          a.lesson.group.name,
          clientName,
          Number(a.chargeAmount),
        ]
      })
    } else if (field === "expenses" || field === "expense-category") {
      // Детализация расходов с учётом периода признания (recognitionMode).
      // Окно выборки расширяется на 60 месяцев — расход с amortized мог быть оплачен
      // раньше, но его доля попадает в текущий месяц ОПИУ.
      const lookback = new Date(monthStart)
      lookback.setUTCMonth(lookback.getUTCMonth() - AMORTIZATION_LOOKBACK_MONTHS)
      const expWhere: any = {
        tenantId,
        deletedAt: null,
        date: { gte: lookback, lte: monthEnd },
      }
      if (categoryId) expWhere.categoryId = categoryId
      if (branchId) expWhere.branches = { some: { branchId } }

      const expenses = await db.expense.findMany({
        where: expWhere,
        include: {
          category: { select: { name: true } },
        },
        orderBy: { date: "desc" },
        take: 500,
      })

      const RECOGNITION_LABELS: Record<string, string> = {
        by_payment_date: "По дате платежа",
        single_period: "В одном месяце",
        amortized: "Раскладка по месяцам",
      }

      // Для каждого расхода — сколько попало в окно ОПИУ.
      type DetailRow = {
        date: Date
        category: string
        amountTotal: number
        amountInPeriod: number
        comment: string
        mode: string
      }
      const detail: DetailRow[] = []
      for (const e of expenses) {
        const inPeriod = expenseAmountInWindow(e, year, month, year, month)
        if (inPeriod === 0) continue
        detail.push({
          date: e.date,
          category: e.category.name,
          amountTotal: Number(e.amount),
          amountInPeriod: inPeriod,
          comment: e.comment ?? "",
          mode: RECOGNITION_LABELS[e.recognitionMode] ?? e.recognitionMode,
        })
      }
      detail.sort((a, b) => b.amountInPeriod - a.amountInPeriod)

      columns = ["Дата платежа", "Категория", "Полная сумма", "В этом месяце", "Признание", "Комментарий"]
      rows = detail.map(d => [
        formatDate(d.date),
        d.category,
        d.amountTotal,
        d.amountInPeriod,
        d.mode,
        d.comment || "—",
      ])
    } else if (field === "other-income" || field === "other-income-category") {
      // Прочие доходы (Payment без subscriptionId, с incomeCategoryId).
      const payWhere: any = {
        tenantId,
        deletedAt: null,
        subscriptionId: null,
        incomeCategoryId: { not: null },
        type: { in: ["incoming", "transfer_in"] },
        date: { gte: monthStart, lte: monthEnd },
      }
      if (incomeCategoryId) payWhere.incomeCategoryId = incomeCategoryId

      const payments = await db.payment.findMany({
        where: payWhere,
        select: {
          amount: true,
          method: true,
          date: true,
          comment: true,
          account: { select: { name: true } },
          incomeCategory: { select: { name: true } },
        },
        orderBy: { date: "desc" },
        take: 500,
      })

      columns = ["Дата", "Категория", "Счёт", "Способ", "Комментарий", "Сумма"]
      rows = payments.map(p => [
        formatDate(p.date),
        p.incomeCategory?.name ?? "—",
        p.account.name,
        METHOD_LABELS[p.method] ?? p.method,
        p.comment ?? "—",
        Number(p.amount),
      ])
    } else if (field === "salary") {
      // Детализация ЗП — инструкторы по факту посещений + позиции выплат окладников.
      const attWhere: any = {
        tenantId,
        lesson: { date: { gte: monthStart, lte: monthEnd } },
        instructorPayEnabled: true,
      }
      if (branchId) attWhere.lesson = { ...attWhere.lesson, group: { branchId } }

      const attendances = await db.attendance.findMany({
        where: attWhere,
        select: {
          instructorPayAmount: true,
          lesson: {
            select: {
              date: true,
              group: { select: { name: true, direction: { select: { name: true } } } },
              instructor: { select: { firstName: true, lastName: true } },
              substituteInstructor: { select: { firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { lesson: { date: "desc" } },
        take: 500,
      })

      // Группируем по сотруднику + направлению (как в новом P&L).
      const byKey = new Map<string, { employee: string; direction: string; lessons: number; amount: number }>()
      for (const a of attendances) {
        const instr = a.lesson.substituteInstructor ?? a.lesson.instructor
        const name = instr ? [instr.lastName, instr.firstName].filter(Boolean).join(" ") : "—"
        const dir = a.lesson.group.direction.name
        const key = `${name}__${dir}`
        const prev = byKey.get(key) || { employee: name, direction: dir, lessons: 0, amount: 0 }
        prev.lessons += 1
        prev.amount += Number(a.instructorPayAmount)
        byKey.set(key, prev)
      }

      columns = ["Сотрудник", "Направление", "Занятий", "Сумма"]
      rows = Array.from(byKey.values())
        .sort((a, b) => b.amount - a.amount)
        .map(r => [r.employee, r.direction, r.lessons, r.amount])
    } else if (field === "payments" || field === "income") {
      // ДДС-приход (по дате платежа).
      const payments = await db.payment.findMany({
        where: {
          tenantId,
          deletedAt: null,
          date: { gte: monthStart, lte: monthEnd },
          type: { in: ["incoming", "transfer_in"] },
        },
        select: {
          amount: true,
          method: true,
          date: true,
          client: { select: { firstName: true, lastName: true } },
          subscription: { select: { direction: { select: { name: true } } } },
          incomeCategory: { select: { name: true } },
        },
        orderBy: { date: "desc" },
        take: 500,
      })

      columns = ["Дата", "Контрагент", "Категория", "Способ", "Сумма"]
      rows = payments.map(p => {
        const clientName = p.client
          ? [p.client.lastName, p.client.firstName].filter(Boolean).join(" ")
          : "Прочий доход"
        const cat = p.subscription?.direction
          ? `Абонемент: ${p.subscription.direction.name}`
          : p.incomeCategory?.name ?? "—"
        return [
          formatDate(p.date),
          clientName,
          cat,
          METHOD_LABELS[p.method] ?? p.method,
          Number(p.amount),
        ]
      })
    } else if (field === "outflow") {
      // Детализация выбытий ДДС (расходы + ЗП выплаты).
      const expenses = await db.expense.findMany({
        where: { tenantId, deletedAt: null, date: { gte: monthStart, lte: monthEnd } },
        include: { category: { select: { name: true } } },
        orderBy: { date: "desc" },
      })

      const salaryPayments = await db.salaryPayment.findMany({
        where: { tenantId, date: { gte: monthStart, lte: monthEnd } },
        include: { employee: { select: { firstName: true, lastName: true } } },
        orderBy: { date: "desc" },
      })

      columns = ["Дата", "Тип", "Описание", "Сумма"]
      rows = [
        ...expenses.map((e) => [
          formatDate(e.date),
          "Расход",
          `${e.category.name}${e.comment ? ": " + e.comment : ""}`,
          Number(e.amount),
        ] as (string | number)[]),
        ...salaryPayments.map((p) => {
          const name = [p.employee.lastName, p.employee.firstName].filter(Boolean).join(" ")
          return [
            formatDate(p.date),
            "Выплата ЗП",
            name,
            Number(p.amount),
          ] as (string | number)[]
        }),
      ].sort((a, b) => String(b[0]).localeCompare(String(a[0])))
    } else {
      return NextResponse.json({ error: `Unknown field: ${field}` }, { status: 400 })
    }

    return NextResponse.json({ columns, rows })
  } catch (err) {
    console.error("[drill-down]", err)
    return NextResponse.json({ error: "Ошибка загрузки данных" }, { status: 500 })
  }
}
