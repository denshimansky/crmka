import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { buildNavMap, buildBaseContext, buildDynamicSlice } from "@/lib/ai-context"

const DAILY_LIMIT = 50

/**
 * POST /api/ai/chat
 * AI-ассистент CRM. Собирает контекст из БД и отвечает через выбранного провайдера.
 * Провайдер выбирается env AI_PROVIDER: "anthropic" (по умолчанию, Messages API)
 * или "openai" (Chat Completions). Модель и base URL каждого провайдера
 * переопределяются через env (см. ниже). Каждый диалог пишется в ai_chat_logs —
 * аудит качества ответов и пополнение FAQ базы знаний (ai-context.ts).
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

    // Промпт разбит на две части: staticPrompt одинаков для всех тенантов и
    // запросов (инструкции + карта навигации) — на нём Anthropic prompt cache
    // (cache_control ниже) срезает ~90% стоимости входных токенов; dynamicPrompt
    // (роль, имя, данные организации) меняется каждый запрос и не кэшируется.
    const staticPrompt = `Ты — AI-помощник внутри CRM-системы «Умная CRM» для детских центров и сферы услуг.

Твои задачи:
1. Отвечать на вопросы «где X / как сделать Y» — объясняя путь ЧЕЛОВЕЧЕСКИМИ СЛОВАМИ через названия пунктов меню из «КАРТЫ НАВИГАЦИИ» ниже. Например: «Откройте «Клиенты» в левом меню (блок «CRM»)» или «Левое меню → «Настройки» → вкладка «Персональные» → «Сотрудники»». НИКОГДА не выдавай технический адрес страницы (вроде /crm/contacts или /staff) — пользователь не понимает URL, ему нужно знать, на какой пункт меню нажать.
2. Отвечать на вопросы по данным организации — кратко, конкретно, с цифрами из блоков «ДАННЫЕ ОРГАНИЗАЦИИ» и «ДЕТАЛИ ПО УПОМЯНУТЫМ В ВОПРОСЕ СУЩНОСТЯМ».

ЖЁСТКИЕ ПРАВИЛА:
- НЕ выдумывай разделы, поля, кнопки. Если страницы/действия нет в КАРТЕ — скажи «такой возможности в системе нет» или «не знаю, уточните у разработчика».
- НЕ давай шаблонных советов вроде «обратитесь в техподдержку», «проверьте раздел Настройки», «зависит от версии». В системе одна версия, и ты знаешь, где что находится.
- НЕ упоминай количество задач/долгов/любых посторонних метрик, если пользователь о них не спрашивал.
- Если в данных нет ответа — скажи честно «по этому вопросу данных в выгрузке нет».
- Если в блоке «ДЕТАЛИ ПО УПОМЯНУТЫМ В ВОПРОСЕ СУЩНОСТЯМ» найдено НЕСКОЛЬКО кандидатов (например, два клиента с похожими фамилиями) — переспроси, кого именно имеют в виду, и перечисли варианты.
- Навигацию ВСЕГДА описывай словами: название пункта меню (в кавычках) и его блок/вкладку. Технические пути (/staff, /finance/cash, и т.п.) писать запрещено — переводи их в названия пунктов меню по «КАРТЕ НАВИГАЦИИ».
- Формат: короткие абзацы, без markdown-разметки.
- Числа: с разделителями (1 000, не 1000). Валюта — ₽.

Бизнес-логика, которую нужно помнить:
- Выручка = отработанные занятия (chargeAmount по посещениям), НЕ оплаты.
- Оборот = движение денег по счетам (ДДС).
- Маржа = Выручка − Переменные расходы (в переменные входит начисленная ЗП инструкторов). Рентабельность = Чистая прибыль / Полный доход (Выручка + Прочие доходы).
- Лид и Клиент — статусы одной сущности. Переход в клиента — при первой оплате. Обратно нельзя.
- Подопечный — ребёнок клиента, информационная сущность, в финансах не участвует.
- Каждый месяц у клиента — отдельный абонемент (для расчёта LTV).
- Постоянные расходы автораспределяются пропорционально выручке по направлениям.
- Цена занятия задаётся на НАПРАВЛЕНИИ (Настройки → вкладка «Организация» → «Направления» → карандаш у направления → поле «Стоимость занятия»). У группы своей цены НЕТ. В абонементе цена фиксируется на момент выписки: уже выписанные абонементы при смене цены направления не меняются, а все новые абонементы и продления (массовые и поштучные) берут актуальный прайс направления.

ПРИМЕРЫ ОТВЕТОВ — образец стиля и формата. Факты ВСЕГДА бери из карты навигации и блоков данных, а не из примеров:

Вопрос: «Где поменять цену занятия?»
Ответ: «Откройте «Настройки» в левом меню, вкладка «Организация», плитка «Направления». Нажмите карандаш у нужного направления и поменяйте поле «Стоимость занятия». Уже выписанные абонементы останутся по старой цене, а все новые абонементы и продления возьмут новую.»

Вопрос: «Как перевести клиента обратно в лиды?»
Ответ: «Никак — это ограничение системы: после первой оплаты лид навсегда становится клиентом, обратного перехода нет. Работайте с таким клиентом через статусы воронки в его карточке.»

Вопрос: «Сколько должна Иванова?» (в блоке данных найдены две клиентки: Иванова Мария и Иванова Анна)
Ответ: «Нашлись две клиентки с фамилией Иванова: Мария и Анна. Про кого именно рассказать?»

Вопрос: «Какая выручка в этом месяце?» (пример: в блоке данных выручка 1 234 567 ₽, расходы 890 000 ₽)
Ответ: «Выручка за текущий месяц — 1 234 567 ₽, расходы — 890 000 ₽, прибыль — 344 567 ₽.»

${navMap}`

    const dynamicPrompt = `Роль пользователя: ${role === "owner" ? "владелец" : role === "manager" ? "управляющий" : role}
Имя: ${userName}

ДАННЫЕ ОРГАНИЗАЦИИ:
${baseContext}${dynamicSlice ? "\n" + dynamicSlice : ""}`

    const systemPrompt = `${staticPrompt}\n\n${dynamicPrompt}`

    const history = (body.history || []).slice(-6)
    let reply: string

    // Модель каждого провайдера переопределяется через env. Дефолт Anthropic —
    // Opus 4.8 (Haiku 4.5 галлюцинировал на «как сделать X»); на боевом msk1
    // с 08.07.2026 через ANTHROPIC_MODEL задан claude-haiku-4-5 (экономия 5×),
    // галлюцинации компенсируются FAQ в ai-context.ts и примерами в промпте.
    // Промежуточный вариант — claude-sonnet-4-6 (в 1.7 раза дешевле Opus).
    // OpenAI: gpt-5.4-mini — оптимум цена/качество (OPENAI_MODEL: gpt-5.4-nano
    // дешевле, gpt-5.5 премиум).
    const model = provider === "openai"
      ? process.env.OPENAI_MODEL || "gpt-5.4-mini"
      : process.env.ANTHROPIC_MODEL || "claude-opus-4-8"

    if (provider === "openai") {
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
      // Anthropic Messages API. Цена входа компенсируется prompt cache на
      // статической части системного промпта (cache_control ниже).
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
          max_tokens: 2000,
          // Статическая часть промпта кэшируется (TTL 5 мин): при активном
          // использовании чата повторные запросы читают её из кэша за ~0.1×
          // цены. Динамика (данные организации) идёт отдельным блоком после.
          system: [
            { type: "text", text: staticPrompt, cache_control: { type: "ephemeral" } },
            { type: "text", text: dynamicPrompt },
          ],
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

    // Лог диалога — сырьё для аудита качества ответов и пополнения FAQ
    // в ai-context.ts (выборка через SQL, UI нет). Сбой записи не должен
    // ломать ответ пользователю. logId возвращается клиенту — по нему
    // кнопки «полезно/не помогло» пишут оценку через /api/ai/feedback.
    let logId: string | null = null
    try {
      const log = await db.aiChatLog.create({
        data: { tenantId, userName, userRole: role, provider, model, message, reply },
        select: { id: true },
      })
      logId = log.id
    } catch (logErr) {
      console.error("[ai/chat] Log write error:", logErr)
    }

    return NextResponse.json({
      reply,
      logId,
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
