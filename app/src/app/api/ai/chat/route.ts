import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { buildNavMap, buildBaseContext, buildDynamicSlice } from "@/lib/ai-context"

const DAILY_LIMIT = 50

/**
 * POST /api/ai/chat
 * AI-ассистент CRM. Собирает контекст из БД и отвечает через OpenAI gpt-5.4-mini
 * (Chat Completions API). Модель можно переопределить через env OPENAI_MODEL.
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

  // --- Rate limiting (per tenant per day, через header — упрощённо) ---
  const usageHeader = req.headers.get("x-ai-usage-count")
  const currentUsage = usageHeader ? parseInt(usageHeader, 10) : 0
  if (currentUsage >= DAILY_LIMIT) {
    return NextResponse.json({
      error: `Достигнут лимит: ${DAILY_LIMIT} запросов в день`,
      remaining: 0,
    }, { status: 429 })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      reply: "AI-ассистент временно недоступен. Обратитесь к администратору.",
      remaining: DAILY_LIMIT - currentUsage,
    })
  }

  try {
    // Параллельная сборка контекста: nav (синхр.), база (Level 1), динамика (Level 2)
    const navMap = buildNavMap()
    const [baseContext, dynamicSlice] = await Promise.all([
      buildBaseContext(tenantId, role),
      buildDynamicSlice(message, tenantId),
    ])

    const systemPrompt = `Ты — AI-помощник внутри CRM-системы «Умная CRM» для детских центров и сферы услуг.

Твои задачи:
1. Отвечать на вопросы «где X / как сделать Y» — точным путём по системе из КАРТЫ СТРАНИЦ ниже. Указывай конкретный URL (например, /staff), а не размытое «раздел Сотрудники».
2. Отвечать на вопросы по данным организации — кратко, конкретно, с цифрами из блоков «ДАННЫЕ ОРГАНИЗАЦИИ» и «ДЕТАЛИ ПО УПОМЯНУТЫМ В ВОПРОСЕ СУЩНОСТЯМ».

ЖЁСТКИЕ ПРАВИЛА:
- НЕ выдумывай разделы, поля, кнопки. Если страницы/действия нет в КАРТЕ — скажи «такой возможности в системе нет» или «не знаю, уточните у разработчика».
- НЕ давай шаблонных советов вроде «обратитесь в техподдержку», «проверьте раздел Настройки», «зависит от версии». В системе одна версия, и ты знаешь, где что находится.
- НЕ упоминай количество задач/долгов/любых посторонних метрик, если пользователь о них не спрашивал.
- Если в данных нет ответа — скажи честно «по этому вопросу данных в выгрузке нет».
- Если в блоке «ДЕТАЛИ ПО УПОМЯНУТЫМ В ВОПРОСЕ СУЩНОСТЯМ» найдено НЕСКОЛЬКО кандидатов (например, два клиента с похожими фамилиями) — переспроси, кого именно имеют в виду, и перечисли варианты.
- Формат: короткие абзацы, без markdown-разметки. Пути пиши как есть (/staff, /finance/cash).
- Числа: с разделителями (1 000, не 1000). Валюта — ₽.

Бизнес-логика, которую нужно помнить:
- Выручка = отработанные занятия (chargeAmount по посещениям), НЕ оплаты.
- Оборот = движение денег по счетам (ДДС).
- Маржа = Выручка − Переменные расходы. Рентабельность = Чистая прибыль / Выручка.
- Лид и Клиент — статусы одной сущности. Переход в клиента — при первой оплате. Обратно нельзя.
- Подопечный — ребёнок клиента, информационная сущность, в финансах не участвует.
- Каждый месяц у клиента — отдельный абонемент (для расчёта LTV).
- Постоянные расходы автораспределяются пропорционально выручке по направлениям.

Роль пользователя: ${role === "owner" ? "владелец" : role === "manager" ? "управляющий" : role}
Имя: ${userName}

${navMap}

ДАННЫЕ ОРГАНИЗАЦИИ:
${baseContext}${dynamicSlice ? "\n" + dynamicSlice : ""}`

    // gpt-5.4-mini — оптимум цена/качество для этой задачи (RAG-ответ по
    // готовому контексту). Можно переопределить через env: gpt-5.4-nano —
    // дешевле, gpt-5.5 — премиум.
    const model = process.env.OPENAI_MODEL || "gpt-5.4-mini"

    // База OpenAI API (с /v1, как у официального SDK). По умолчанию api.openai.com.
    // OpenAI блокирует часть РФ-IP (в т.ч. наш MSK-сервер) — на таком хосте задаём
    // OPENAI_BASE_URL на совместимый шлюз/релей с незаблокированным egress
    // (напр. через сервер в Финляндии). Значение должно оканчиваться на /v1.
    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        // GPT-5.x — reasoning-модель: max_completion_tokens покрывает и скрытые
        // reasoning-токены, поэтому лимит выше прежних 1024 (иначе видимый ответ
        // может обрезаться). reasoning_effort=low — глубокое рассуждение тут не
        // нужно, это быстрее и дешевле. temperature/top_p и прочие
        // sampling-параметры reasoning-модели не поддерживают — не шлём.
        max_completion_tokens: 2000,
        reasoning_effort: "low",
        messages: [
          { role: "system", content: systemPrompt },
          ...(body.history || []).slice(-6),
          { role: "user", content: message },
        ],
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      console.error("[ai/chat] OpenAI API error:", response.status, errBody)
      return NextResponse.json({
        reply: "Не удалось получить ответ от AI. Попробуйте позже.",
        remaining: DAILY_LIMIT - currentUsage,
      })
    }

    const data = await response.json()
    const reply = data.choices?.[0]?.message?.content?.trim() || "Нет ответа"

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
