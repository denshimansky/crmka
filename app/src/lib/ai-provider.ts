/**
 * Единая точка обращения к ИИ-провайдеру.
 *
 * Здесь собрана вся возня со стыком: выбор провайдера (`AI_PROVIDER`), модели
 * (`ANTHROPIC_MODEL` / `OPENAI_MODEL`) и адреса (`*_BASE_URL` — на боевом msk1
 * это наш релей на Hetzner: IP московского дата-центра Anthropic отдаёт 403).
 * Всё переключается переменными окружения, без правок кода.
 *
 * Функций-потребителей две — ИИ-ассистент CRM (`/api/ai/chat`) и черновик
 * ответа родителю (`/api/ext/ai-reply`), и разъезжаться им нельзя: настройка
 * релея хрупкая, и чинить её в двух местах — гарантированно забыть про второе.
 *
 * Промпт разделён на статическую и динамическую части: у Anthropic статическая
 * кэшируется (`cache_control`), и повторные запросы читают её примерно за 0.1×
 * цены входных токенов. У OpenAI обе части просто склеиваются.
 */

export interface AiMessage {
  role: "user" | "assistant"
  content: string
}

export interface AiCallOptions {
  /** Одинаковая для всех запросов часть системного промпта — она и кэшируется. */
  systemStatic: string
  /** Меняющаяся часть (данные организации, роль, имя) — не кэшируется. */
  systemDynamic?: string
  messages: AiMessage[]
  maxTokens?: number
}

export interface AiCallResult {
  text: string
  provider: string
  model: string
}

/** Провайдер ответил ошибкой либо не настроен: вызывающий решает, что сказать человеку. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status: number = 0,
  ) {
    super(message)
    this.name = "AiProviderError"
  }
}

/** Какой провайдер настроен сейчас: "anthropic" (по умолчанию) или "openai". */
export function aiProvider(): "anthropic" | "openai" {
  return (process.env.AI_PROVIDER || "anthropic").toLowerCase() === "openai"
    ? "openai"
    : "anthropic"
}

/** Ключ выбранного провайдера. Нет ключа — ИИ-функции просто выключены. */
export function aiApiKey(): string | undefined {
  return aiProvider() === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY
}

/** Настроен ли ИИ вообще (проверять до показа кнопок и до списания лимита). */
export function aiConfigured(): boolean {
  return Boolean(aiApiKey())
}

/**
 * Модель выбранного провайдера.
 *
 * Дефолт Anthropic — Opus 4.8 (Haiku 4.5 галлюцинировал на «как сделать X»);
 * на боевом msk1 через `ANTHROPIC_MODEL` задан claude-haiku-4-5 (экономия 5×),
 * галлюцинации компенсируются FAQ и примерами в промпте. Промежуточный
 * вариант — claude-sonnet-4-6. OpenAI: gpt-5.4-mini — оптимум цена/качество
 * (gpt-5.4-nano дешевле, gpt-5.5 премиум).
 */
export function aiModel(): string {
  return aiProvider() === "openai"
    ? process.env.OPENAI_MODEL || "gpt-5.4-mini"
    : process.env.ANTHROPIC_MODEL || "claude-opus-4-8"
}

export async function callAi(options: AiCallOptions): Promise<AiCallResult> {
  const provider = aiProvider()
  const model = aiModel()
  const apiKey = aiApiKey()
  if (!apiKey) throw new AiProviderError("ИИ не настроен: нет ключа провайдера")

  const maxTokens = options.maxTokens ?? 2000

  if (provider === "openai") {
    // База OpenAI API (с /v1, как у официального SDK). По умолчанию api.openai.com.
    // Для заблокированного хоста — OPENAI_BASE_URL на релей (напр. .../oai/v1).
    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")
    const system = [options.systemStatic, options.systemDynamic].filter(Boolean).join("\n\n")

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        // GPT-5.x — reasoning-модель: max_completion_tokens покрывает и скрытые
        // reasoning-токены; reasoning_effort=low — глубокое рассуждение не нужно;
        // sampling-параметры (temperature и т.п.) reasoning-модели не поддерживают.
        model,
        max_completion_tokens: maxTokens,
        reasoning_effort: "low",
        messages: [{ role: "system", content: system }, ...options.messages],
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      console.error("[ai] OpenAI API error:", response.status, errBody)
      throw new AiProviderError(`OpenAI ответил ошибкой ${response.status}`, response.status)
    }

    const data = await response.json()
    return {
      text: data.choices?.[0]?.message?.content?.trim() || "",
      provider,
      model,
    }
  }

  // Anthropic Messages API. База — без /v1 (путь добавляем сами), как у
  // официального SDK; ANTHROPIC_BASE_URL уводит запрос на релей.
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
      max_tokens: maxTokens,
      // Статическая часть промпта кэшируется (TTL 5 мин): при активном
      // использовании повторные запросы читают её из кэша.
      system: options.systemDynamic
        ? [
            { type: "text", text: options.systemStatic, cache_control: { type: "ephemeral" } },
            { type: "text", text: options.systemDynamic },
          ]
        : [{ type: "text", text: options.systemStatic, cache_control: { type: "ephemeral" } }],
      messages: options.messages,
    }),
  })

  if (!response.ok) {
    const errBody = await response.text()
    console.error("[ai] Anthropic API error:", response.status, errBody)
    throw new AiProviderError(`Anthropic ответил ошибкой ${response.status}`, response.status)
  }

  const data = await response.json()
  return { text: data.content?.[0]?.text?.trim() || "", provider, model }
}

/**
 * Дневной лимит обращений к ИИ — на ОРГАНИЗАЦИЮ, общий на всех сотрудников и
 * на все ИИ-функции (ассистент CRM и черновик ответа в мессенджере). Считается
 * по фактически записанным диалогам в ai_chat_logs за текущие сутки UTC:
 * заголовку с клиента доверять нельзя, он обходится.
 */
export const AI_DAILY_LIMIT = 50
