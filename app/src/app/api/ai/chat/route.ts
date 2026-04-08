import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

const DAILY_LIMIT = 50

/**
 * POST /api/ai/chat
 * AI-ассистент CRM. Собирает контекст из БД и отвечает через Claude Haiku.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tenantId = (session.user as any).tenantId
  const role = (session.user as any).role as string
  const userName = session.user.name || "Пользователь"

  const body = await req.json()
  const message = body.message?.trim()
  if (!message) {
    return NextResponse.json({ error: "Пустое сообщение" }, { status: 400 })
  }

  // --- Rate limiting (simple: per tenant per day) ---
  const todayKey = new Date().toISOString().split("T")[0]
  const cacheKey = `ai_usage:${tenantId}:${todayKey}`

  // Используем простой подсчёт через БД (можно заменить на Redis)
  // Пока считаем через header/cookie — упрощённо
  const usageHeader = req.headers.get("x-ai-usage-count")
  const currentUsage = usageHeader ? parseInt(usageHeader, 10) : 0
  if (currentUsage >= DAILY_LIMIT) {
    return NextResponse.json({
      error: `Достигнут лимит: ${DAILY_LIMIT} запросов в день`,
      remaining: 0,
    }, { status: 429 })
  }

  // --- Собираем контекст из БД ---
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      reply: "AI-ассистент временно недоступен. Обратитесь к администратору.",
      remaining: DAILY_LIMIT - currentUsage,
    })
  }

  try {
    const context = await buildContext(tenantId, role)

    const systemPrompt = `Ты — AI-аналитик CRM-системы «Умная CRM» для детских центров и сферы услуг.

Твоя задача: отвечать на вопросы владельца/сотрудника по данным их организации.
Отвечай кратко, конкретно, с цифрами. Используй данные ниже.
Если данных для ответа нет — скажи честно.
Форматируй ответ для чата: короткие абзацы, без markdown.
Числа форматируй с разделителями (1 000, не 1000). Валюта — ₽.

Роль пользователя: ${role === "owner" ? "владелец" : role === "manager" ? "управляющий" : role}
Имя: ${userName}

ДАННЫЕ ОРГАНИЗАЦИИ:
${context}`

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          ...(body.history || []).slice(-6),
          { role: "user", content: message },
        ],
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      console.error("[ai/chat] Anthropic API error:", response.status, errBody)
      return NextResponse.json({
        reply: "Не удалось получить ответ от AI. Попробуйте позже.",
        remaining: DAILY_LIMIT - currentUsage,
      })
    }

    const data = await response.json()
    const reply = data.content?.[0]?.text || "Нет ответа"

    return NextResponse.json({
      reply,
      remaining: DAILY_LIMIT - currentUsage - 1,
    })
  } catch (err) {
    console.error("[ai/chat] Error:", err)
    return NextResponse.json({
      reply: "Произошла ошибка. Попробуйте позже.",
      remaining: DAILY_LIMIT - currentUsage,
    })
  }
}

/** Собирает ключевые метрики из БД для системного промпта */
async function buildContext(tenantId: string, role: string): Promise<string> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const monthName = now.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  // Параллельные запросы
  const [
    org,
    branches,
    clientCount,
    leadCount,
    activeSubscriptions,
    revenueAttendances,
    expensesAgg,
    debtors,
    tasksOpen,
    groups,
  ] = await Promise.all([
    // Организация
    db.organization.findUnique({
      where: { id: tenantId },
      select: { name: true, legalName: true },
    }),

    // Филиалы
    db.branch.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    }),

    // Клиенты (с clientStatus = активные клиенты)
    db.client.count({
      where: { tenantId, deletedAt: null, clientStatus: { not: null } },
    }),

    // Лиды (в воронке, ещё не клиенты)
    db.client.count({
      where: { tenantId, deletedAt: null, clientStatus: null, funnelStatus: { not: "active_client" } },
    }),

    // Активные абонементы
    db.subscription.count({
      where: { tenantId, deletedAt: null, status: "active" },
    }),

    // Выручка за месяц
    db.attendance.findMany({
      where: {
        tenantId,
        lesson: { date: { gte: monthStart, lte: monthEnd } },
        attendanceType: { countsAsRevenue: true },
      },
      select: { chargeAmount: true },
    }),

    // Расходы за месяц
    db.expense.aggregate({
      where: { tenantId, deletedAt: null, date: { gte: monthStart, lte: monthEnd } },
      _sum: { amount: true },
    }),

    // Должники
    db.subscription.findMany({
      where: { tenantId, deletedAt: null, status: "active", balance: { lt: 0 } },
      select: { balance: true, client: { select: { firstName: true, lastName: true } } },
    }),

    // Открытые задачи
    db.task.count({
      where: { tenantId, deletedAt: null, completedAt: null },
    }),

    // Группы
    db.group.findMany({
      where: { tenantId, deletedAt: null },
      select: { name: true, maxStudents: true, _count: { select: { enrollments: true } } },
    }),
  ])

  const revenue = revenueAttendances.reduce((s, a) => s + Number(a.chargeAmount), 0)
  const expenses = Number(expensesAgg._sum.amount || 0)
  const profit = revenue - expenses
  const totalDebt = debtors.reduce((s, d) => s + Math.abs(Number(d.balance)), 0)

  const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n))

  let ctx = `Организация: ${org?.name || "—"}
Филиалы (${branches.length}): ${branches.map(b => b.name).join(", ") || "—"}
Дата: ${now.toLocaleDateString("ru-RU")}

--- ${monthName} ---
Клиентов: ${clientCount}
Лидов: ${leadCount}
Активных абонементов: ${activeSubscriptions}
Выручка: ${fmt(revenue)} ₽
Расходы: ${fmt(expenses)} ₽
Прибыль: ${fmt(profit)} ₽
Открытых задач: ${tasksOpen}
`

  if (debtors.length > 0) {
    ctx += `\nДолжники (${debtors.length}, сумма ${fmt(totalDebt)} ₽):\n`
    debtors.slice(0, 10).forEach(d => {
      ctx += `  - ${d.client.lastName} ${d.client.firstName}: ${fmt(Math.abs(Number(d.balance)))} ₽\n`
    })
  }

  if (groups.length > 0) {
    ctx += `\nГруппы (${groups.length}):\n`
    groups.slice(0, 15).forEach(g => {
      const fill = g.maxStudents ? Math.round((g._count.enrollments / g.maxStudents) * 100) : 0
      ctx += `  - ${g.name}: ${g._count.enrollments}/${g.maxStudents || "?"} (${fill}%)\n`
    })
  }

  return ctx
}
