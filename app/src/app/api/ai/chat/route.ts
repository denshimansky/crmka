import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { buildNavMap, buildBaseContext, buildDynamicSlice } from "@/lib/ai-context"

const DAILY_LIMIT = 50

/**
 * POST /api/ai/chat
 * AI-ассистент CRM. Собирает контекст из БД и отвечает через выбранного провайдера.
 * Провайдер выбирается env AI_PROVIDER: "anthropic" (по умолчанию, Claude Haiku 4.5
 * через Messages API) или "openai" (gpt-5.4-mini через Chat Completions). Модель и
 * base URL каждого провайдера переопределяются через env (см. ниже).
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

  // Провайдер: anthropic (Claude, по умолчанию) или openai. Релей на Hetzner
  // умеет оба (/anthropic/ и /oai/), переключение — только через env, без правок кода.
  const provider = (process.env.AI_PROVIDER || "anthropic").toLowerCase()
  const apiKey = provider === "openai"
    ? process.env.OPENAI_API_KEY
    : process.env.ANTHROPIC_API_KEY
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

    const history = (body.history || []).slice(-6)
    let reply: string

    if (provider === "openai") {
      // gpt-5.4-mini — оптимум цена/качество. Переопределяется через OPENAI_MODEL
      // (gpt-5.4-nano дешевле, gpt-5.5 премиум).
      const model = process.env.OPENAI_MODEL || "gpt-5.4-mini"
      // База OpenAI API (с /v1, как у официального SDK). По умолчанию api.openai.com.
      // Для заблокированного хоста — OPENAI_BASE_URL на релей (напр. .../oai/v1).
      const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          // GPT-5.x — reasoning-модель: max_completion_tokens покрывает и скрытые
          // reasoning-токены; reasoning_effort=low — глубокое рассуждение не нужно;
          // sampling-параметры (temperature и т.п.) reasoning-модели не поддерживают.
          model,
          max_completion_tokens: 2000,
          reasoning_effort: "low",
          messages: [
            { role: "system", content: systemPrompt },
            ...history,
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
      reply = data.choices?.[0]?.message?.content?.trim() || "Нет ответа"
    } else {
      // Anthropic Claude Haiku 4.5 (Messages API) — самый дешёвый/быстрый тир,
      // достаточный для RAG-Q&A. Переопределяется через ANTHROPIC_MODEL.
      const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5"
      // База Anthropic API (без /v1, как у официального SDK — путь добавляем сами).
      // Для заблокированного хоста — ANTHROPIC_BASE_URL на релей (напр. .../anthropic).
      const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "")

      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [
            ...history,
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
      reply = data.content?.[0]?.text?.trim() || "Нет ответа"
    }

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
