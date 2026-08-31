import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { buildNavMap, buildBaseContext, buildDynamicSlice, buildFaqSlices } from "@/lib/ai-context"
import { AI_DAILY_LIMIT as DAILY_LIMIT, aiConfigured, callAi } from "@/lib/ai-provider"


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

  // --- Лимит: DAILY_LIMIT ответов в сутки НА ОРГАНИЗАЦИЮ (tenant), общий на всех
  // сотрудников. Считаем реально записанные диалоги за текущие сутки (UTC) —
  // заголовку с клиента доверять нельзя (обходится). Индекс [tenantId, createdAt]. ---
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const usedToday = await db.aiChatLog.count({
    where: { tenantId, createdAt: { gte: startOfDay } },
  })
  if (usedToday >= DAILY_LIMIT) {
    return NextResponse.json({
      error: `Достигнут дневной лимит запросов к ИИ (${DAILY_LIMIT} в сутки на организацию). Лимит обновится завтра.`,
      remaining: 0,
    }, { status: 429 })
  }

  // Провайдер, модель и адрес (в т.ч. релей на Hetzner) — в lib/ai-provider.ts:
  // общая точка с черновиком ответа для расширения, настройка релея хрупкая и
  // жить в двух копиях не должна.
  if (!aiConfigured()) {
    return NextResponse.json({
      reply: "AI-ассистент временно недоступен. Обратитесь к администратору.",
      remaining: DAILY_LIMIT - usedToday,
    })
  }

  try {
    // Параллельная сборка контекста: nav (синхр.), база (Level 1), динамика
    // (Level 2) и база знаний ai_faq — ядро в кэшируемую статику, подборка по
    // теме вопроса в динамическую часть.
    const navMap = buildNavMap()
    // Записи базы знаний отбираются по ТЕКСТУ ВОПРОСА, поэтому берём и пару
    // последних реплик пользователя: в «а как её отменить?» своих слов для
    // поиска нет — тема живёт в предыдущем сообщении.
    const recentUserText = [
      ...((body.history || []) as { role: string; content: string }[])
        .filter((m) => m.role === "user")
        .slice(-2)
        .map((m) => m.content),
      message,
    ].join(" ")
    const [baseContext, dynamicSlice, faq] = await Promise.all([
      buildBaseContext(tenantId, role, (session.user as any).employeeId ?? null, (session.user as any).allowedBranchIds ?? null),
      buildDynamicSlice(message, tenantId),
      buildFaqSlices(recentUserText),
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
- Лид и Клиент — статусы одной сущности. Переход в клиента — при оплате абонемента (на любую сумму) или первом платном занятии; простое пополнение баланса статус НЕ меняет. Обратно нельзя.
- Подопечный — ребёнок клиента, информационная сущность, в финансах не участвует.
- Каждый месяц у клиента — отдельный абонемент (для расчёта LTV).
- Постоянные расходы автораспределяются пропорционально выручке по направлениям.
- Цена занятия задаётся на НАПРАВЛЕНИИ (Настройки → вкладка «Организация» → «Направления» → карандаш у направления → поле «Стоимость занятия»). У группы своей цены НЕТ. В абонементе цена фиксируется на момент выписки: уже выписанные абонементы при смене цены направления не меняются, а все новые абонементы и продления (массовые и поштучные) берут актуальный прайс направления.

ПРИМЕРЫ ОТВЕТОВ — образец стиля и формата. Факты ВСЕГДА бери из карты навигации и блоков данных, а не из примеров:

Вопрос: «Где поменять цену занятия?»
Ответ: «Откройте «Настройки» в левом меню, вкладка «Организация», плитка «Направления». Нажмите карандаш у нужного направления и поменяйте поле «Стоимость занятия». Уже выписанные абонементы останутся по старой цене, а все новые абонементы и продления возьмут новую.»

Вопрос: «Как перевести клиента обратно в лиды?»
Ответ: «Никак — это ограничение системы: как только лид стал клиентом (оплата абонемента или первое платное занятие), обратного перехода нет. Работайте с таким клиентом через статусы воронки в его карточке.»

Вопрос: «Сколько должна Иванова?» (в блоке данных найдены две клиентки: Иванова Мария и Иванова Анна)
Ответ: «Нашлись две клиентки с фамилией Иванова: Мария и Анна. Про кого именно рассказать?»

Вопрос: «Какая выручка в этом месяце?» (пример: в блоке данных выручка 1 234 567 ₽, расходы 890 000 ₽)
Ответ: «Выручка за текущий месяц — 1 234 567 ₽, расходы — 890 000 ₽, прибыль — 344 567 ₽.»

${navMap}${faq.core ? "\n\n" + faq.core : ""}`

    const dynamicPrompt = `Роль пользователя: ${role === "owner" ? "владелец" : role === "manager" ? "управляющий" : role}
Имя: ${userName}

ДАННЫЕ ОРГАНИЗАЦИИ:
${baseContext}${dynamicSlice ? "\n" + dynamicSlice : ""}${faq.matched ? "\n\n" + faq.matched : ""}`

    const history = (body.history || []).slice(-6)

    let reply: string
    let provider: string
    let model: string
    try {
      const answer = await callAi({
        systemStatic: staticPrompt,
        systemDynamic: dynamicPrompt,
        messages: [...history, { role: "user", content: message }],
      })
      reply = answer.text || "Нет ответа"
      provider = answer.provider
      model = answer.model
    } catch (providerErr) {
      // Провайдер недоступен (упал релей, кончилась квота) — это не поломка
      // ассистента, человеку нужен понятный ответ, а не 500.
      console.error("[ai/chat] Provider error:", providerErr)
      return NextResponse.json({
        reply: "Не удалось получить ответ от AI. Попробуйте позже.",
        remaining: DAILY_LIMIT - usedToday,
      })
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
      remaining: Math.max(0, DAILY_LIMIT - usedToday - 1),
    })
  } catch (err) {
    console.error("[ai/chat] Error:", err)
    return NextResponse.json({
      reply: "Произошла ошибка. Попробуйте позже.",
      remaining: DAILY_LIMIT - usedToday,
    })
  }
}
