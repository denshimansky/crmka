import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount))
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = (session.user as any).tenantId
  const { searchParams } = new URL(req.url)

  const report = searchParams.get("report") // pnl, revenue, dds
  const field = searchParams.get("field") // revenue, expenses, salary, payments
  const monthParam = searchParams.get("month") // 2026-04
  const branchId = searchParams.get("branchId")

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
  const monthEnd = new Date(Date.UTC(year, month, 0))

  try {
    let columns: string[] = []
    let rows: (string | number)[][] = []

    if (field === "revenue") {
      // Детализация выручки — список посещений с суммами
      const attendances = await db.attendance.findMany({
        where: {
          tenantId,
          lesson: { date: { gte: monthStart, lte: monthEnd } },
          attendanceType: { countsAsRevenue: true },
        },
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
            },
          },
        },
        orderBy: { lesson: { date: "desc" } },
        take: 500,
      })

      columns = ["Дата", "Группа", "Ученик", "Сумма"]
      rows = attendances.map((a) => {
        const clientName = a.subscription?.client
          ? [a.subscription.client.lastName, a.subscription.client.firstName].filter(Boolean).join(" ")
          : "—"
        return [
          formatDate(a.lesson.date),
          a.lesson.group.name,
          clientName,
          Number(a.chargeAmount),
        ]
      })
    } else if (field === "expenses") {
      // Детализация расходов
      const expenses = await db.expense.findMany({
        where: {
          tenantId,
          deletedAt: null,
          date: { gte: monthStart, lte: monthEnd },
        },
        include: {
          category: { select: { name: true } },
        },
        orderBy: { date: "desc" },
        take: 500,
      })

      columns = ["Дата", "Категория", "Описание", "Сумма"]
      rows = expenses.map((e) => [
        formatDate(e.date),
        e.category.name,
        e.description || "—",
        Number(e.amount),
      ])
    } else if (field === "salary") {
      // Детализация ЗП
      const attendances = await db.attendance.findMany({
        where: {
          tenantId,
          lesson: { date: { gte: monthStart, lte: monthEnd } },
          instructorPayEnabled: true,
        },
        select: {
          instructorPayAmount: true,
          lesson: {
            select: {
              date: true,
              group: { select: { name: true } },
              instructor: { select: { firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { lesson: { date: "desc" } },
        take: 500,
      })

      // Группируем по инструктору
      const byInstructor = new Map<string, { name: string; lessons: number; amount: number }>()
      for (const a of attendances) {
        const name = a.lesson.instructor
          ? [a.lesson.instructor.lastName, a.lesson.instructor.firstName].filter(Boolean).join(" ")
          : "—"
        const prev = byInstructor.get(name) || { name, lessons: 0, amount: 0 }
        prev.lessons += 1
        prev.amount += Number(a.instructorPayAmount)
        byInstructor.set(name, prev)
      }

      columns = ["Инструктор", "Занятий/учеников", "Сумма"]
      rows = Array.from(byInstructor.values())
        .sort((a, b) => b.amount - a.amount)
        .map((r) => [r.name, r.lessons, r.amount])
    } else if (field === "payments" || field === "income") {
      // Детализация оплат (для ДДС — приход)
      const payments = await db.payment.findMany({
        where: {
          tenantId,
          deletedAt: null,
          date: { gte: monthStart, lte: monthEnd },
        },
        select: {
          amount: true,
          method: true,
          date: true,
          subscription: {
            select: {
              client: { select: { firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { date: "desc" },
        take: 500,
      })

      const METHOD_LABELS: Record<string, string> = {
        cash: "Наличные",
        bank_transfer: "Безнал",
        acquiring: "Эквайринг",
        online_yukassa: "ЮKassa",
        online_robokassa: "Робокасса",
        sbp_qr: "СБП",
      }

      columns = ["Дата", "Клиент", "Способ", "Сумма"]
      rows = payments.map((p) => {
        const clientName = p.subscription?.client
          ? [p.subscription.client.lastName, p.subscription.client.firstName].filter(Boolean).join(" ")
          : "—"
        return [
          formatDate(p.date),
          clientName,
          METHOD_LABELS[p.method] || p.method,
          Number(p.amount),
        ]
      })
    } else if (field === "outflow") {
      // Детализация расходов ДДС (расходы + ЗП выплаты + операции)
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
          `${e.category.name}${e.description ? ": " + e.description : ""}`,
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
