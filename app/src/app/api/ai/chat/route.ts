import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { pageHelpContent } from "@/lib/page-help-content"

const DAILY_LIMIT = 50

/**
 * Карта страниц CRM (автогенерируется из pageHelpContent) + ручной FAQ
 * для «спрятанных» действий внутри страниц. Используется AI-ассистентом,
 * чтобы давать конкретные пути вместо абстрактных советов.
 */
function buildNavMap(): string {
  const pageLines: string[] = []
  for (const [key, content] of Object.entries(pageHelpContent)) {
    const path = key === "dashboard" ? "/" : `/${key}`
    pageLines.push(`- ${path} — ${content.title}: ${content.subtitle}`)
  }

  const faq = [
    "СПРЯТАННЫЕ ДЕЙСТВИЯ (часто спрашивают «где»):",
    "- Ставка ЗП педагога: /staff → иконка кошелька рядом с инструктором → диалог «Ставки». Поддерживает 5 схем: за ученика, за занятие, фикс за выход + за ученика, % от списаний, плавающая по числу учеников. Можно задать дефолт и исключения по направлениям",
    "- Переопределить ставку для конкретной группы: /schedule/groups/[id] → кнопка «Ставка группы» (перебивает базовую ставку инструктора)",
    "- Создать перевод/инкассацию/выемку собственника: /finance/cash → кнопка «Операция» в шапке",
    "- Создать новый счёт (касса, расчётный, эквайринг, онлайн): /finance/cash → кнопка «Счёт»",
    "- Архивировать счёт: /finance/cash → карандаш у счёта (доступно только при нулевом балансе)",
    "- Зачислить ученика в группу: /schedule → клик по группе → «Добавить ученика»",
    "- Отметить посещение: /schedule → клик по занятию → lesson card → отметка ученикам",
    "- Возврат денег клиенту: /crm/contacts/[id] → раздел абонементов → «Возврат»",
    "- Создать абонемент: /crm/contacts/[id] → «Новый абонемент» (или через подопечного в статусе «Ожидаем оплату»)",
    "- Скидки и шаблоны скидок: /settings → справочники → «Шаблоны скидок»",
    "- Каналы привлечения, направления, кабинеты, причины отчисления/пропусков: /settings → справочники",
    "- Настройка прав ролей: /settings → «Права и роли» (матрица разрешений)",
    "- Кампания обзвона: /crm/calls → «Новая кампания»",
    "- Импорт клиентов: /crm/contacts → «Импорт» (CSV/XLSX)",
    "- Закрытие месяца / снимок периода: /finance/dds → меню «Закрыть период»",
    "- Зарплатная ведомость и выплаты: /salary",
    "- Биллинг подписки на CRM (счета от umnayacrm.ru): /billing",
  ].join("\n")

  return `КАРТА СТРАНИЦ CRM:\n${pageLines.join("\n")}\n\n${faq}`
}

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
    const [context, navMap] = [await buildContext(tenantId, role), buildNavMap()]

    const systemPrompt = `Ты — AI-помощник внутри CRM-системы «Умная CRM» для детских центров и сферы услуг.

Твои задачи:
1. Отвечать на вопросы «где X / как сделать Y» — точным путём по системе из КАРТЫ СТРАНИЦ ниже. Указывай конкретный URL (например, /staff), а не размытое «раздел Сотрудники».
2. Отвечать на вопросы по данным организации — кратко, конкретно, с цифрами из блока «ДАННЫЕ ОРГАНИЗАЦИИ».

ЖЁСТКИЕ ПРАВИЛА:
- НЕ выдумывай разделы, поля, кнопки. Если страницы/действия нет в КАРТЕ — скажи «такой возможности в системе нет» или «не знаю, уточните у разработчика».
- НЕ давай шаблонных советов вроде «обратитесь в техподдержку», «проверьте раздел Настройки», «зависит от версии». В системе одна версия, и ты знаешь, где что находится.
- НЕ упоминай количество задач/долгов, если пользователь о них не спрашивал.
- Если в данных нет ответа — скажи честно «по этому вопросу данных в выгрузке нет».
- Формат: короткие абзацы, без markdown-разметки. Пути пиши как есть (/staff, /finance/cash).
- Числа: с разделителями (1 000, не 1000). Валюта — ₽.

Роль пользователя: ${role === "owner" ? "владелец" : role === "manager" ? "управляющий" : role}
Имя: ${userName}

${navMap}

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

/** Собирает ключевые метрики из БД для системного промпта (текущий + 3 предыдущих месяца) */
async function buildContext(tenantId: string, role: string): Promise<string> {
  const now = new Date()
  const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n))

  // Период: 4 месяца (текущий + 3 предыдущих)
  const months: { start: Date; end: Date; name: string }[] = []
  for (let i = 3; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0)
    const name = start.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
    months.push({ start, end, name })
  }

  const periodStart = months[0].start
  const periodEnd = months[months.length - 1].end

  // Параллельные запросы
  const [
    org,
    branches,
    clientCount,
    leadCount,
    activeSubscriptions,
    revenueAttendances,
    expenses,
    debtors,
    tasksOpen,
    groups,
  ] = await Promise.all([
    db.organization.findUnique({
      where: { id: tenantId },
      select: { name: true, legalName: true },
    }),
    db.branch.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    }),
    db.client.count({
      where: { tenantId, deletedAt: null, clientStatus: { not: null } },
    }),
    db.client.count({
      where: { tenantId, deletedAt: null, clientStatus: null, funnelStatus: { not: "active_client" } },
    }),
    db.subscription.count({
      where: { tenantId, deletedAt: null, status: "active" },
    }),
    // Выручка за весь период
    db.attendance.findMany({
      where: {
        tenantId,
        lesson: { date: { gte: periodStart, lte: periodEnd } },
        attendanceType: { countsAsRevenue: true },
      },
      select: { chargeAmount: true, lesson: { select: { date: true } } },
    }),
    // Расходы за весь период
    db.expense.findMany({
      where: { tenantId, deletedAt: null, date: { gte: periodStart, lte: periodEnd } },
      select: { amount: true, date: true },
    }),
    db.subscription.findMany({
      where: { tenantId, deletedAt: null, status: "active", balance: { lt: 0 } },
      select: { balance: true, client: { select: { firstName: true, lastName: true } } },
    }),
    db.task.count({
      where: { tenantId, deletedAt: null, completedAt: null },
    }),
    db.group.findMany({
      where: { tenantId, deletedAt: null },
      select: { name: true, maxStudents: true, _count: { select: { enrollments: true } } },
    }),
  ])

  const totalDebt = debtors.reduce((s, d) => s + Math.abs(Number(d.balance)), 0)

  let ctx = `Организация: ${org?.name || "—"}
Филиалы (${branches.length}): ${branches.map(b => b.name).join(", ") || "—"}
Дата: ${now.toLocaleDateString("ru-RU")}
Клиентов: ${clientCount}, Лидов: ${leadCount}
Активных абонементов: ${activeSubscriptions}
Открытых задач: ${tasksOpen}
`

  // Помесячная разбивка
  for (const m of months) {
    const mRevenue = revenueAttendances
      .filter(a => {
        const d = new Date(a.lesson.date)
        return d >= m.start && d <= m.end
      })
      .reduce((s, a) => s + Number(a.chargeAmount), 0)

    const mExpenses = expenses
      .filter(e => {
        const d = new Date(e.date)
        return d >= m.start && d <= m.end
      })
      .reduce((s, e) => s + Number(e.amount), 0)

    const mProfit = mRevenue - mExpenses
    ctx += `\n--- ${m.name} ---\nВыручка: ${fmt(mRevenue)} ₽ | Расходы: ${fmt(mExpenses)} ₽ | Прибыль: ${fmt(mProfit)} ₽\n`
  }

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
