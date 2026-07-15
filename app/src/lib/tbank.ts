/**
 * Клиент Т-Банк Business API (Invoicing)
 *
 * Документация:
 *   https://developer.tbank.ru/docs/products/invoicing
 *   https://developer.tbank.ru/docs/api/post-api-v-1-invoice-send
 *   https://developer.tbank.ru/docs/api/get-api-v-1-invoice-invoice-id-info
 *
 * Production: https://business.tbank.ru/openapi/api/v1/...
 * Sandbox:    https://business.tbank.ru/openapi/sandbox/api/v1/...
 *
 * Аутентификация: Authorization: Bearer <TOKEN>
 * Токен выпускается в ЛК Т-Бизнеса.
 */

// --- Типы ---

export interface TBankInvoicePayer {
  /** Наименование плательщика */
  name: string
  /** ИНН плательщика */
  inn: string
  /** КПП плательщика (для юрлиц) */
  kpp?: string
}

export interface TBankInvoiceItem {
  /** Наименование товара/услуги */
  name: string
  /** Цена за единицу (в рублях, дробное) */
  price: number
  /** Единица измерения */
  unit: string
  /** Ставка НДС: "None" | "0" | "10" | "20" */
  vat: "None" | "0" | "10" | "20"
  /** Количество */
  amount: number
}

export interface CreateInvoiceParams {
  /** Номер счёта (цифры, до 15 символов) */
  invoiceNumber: string
  /** Дата выставления (YYYY-MM-DD). По умолчанию — сегодня */
  invoiceDate?: string
  /** Срок оплаты (YYYY-MM-DD) */
  dueDate: string
  /** Плательщик */
  payer: TBankInvoicePayer
  /** Позиции (макс 100) */
  items: TBankInvoiceItem[]
  /** Email для отправки счёта */
  contacts?: { email?: string; phone?: string }[]
  /** Комментарий (до 1000 символов) */
  comment?: string
}

export interface CreateInvoiceResult {
  /** ID счёта в Т-Банк */
  invoiceId: string
  /** URL для оплаты / просмотра в ЛК Т-Банк */
  paymentUrl: string | null
  /** Ссылка на PDF счёта */
  pdfUrl: string | null
}

/** Статусы счёта из Т-Банк API */
export type TBankInvoiceStatus =
  | "NEW"          // Создан
  | "SENT"         // Отправлен
  | "VIEWED"       // Просмотрен
  | "PAID"         // Оплачен
  | "PARTIALLY_PAID" // Частично оплачен
  | "OVERDUE"      // Просрочен
  | "CANCELLED"    // Отменён
  | string         // На случай новых статусов

export interface InvoiceStatusResult {
  invoiceId: string
  status: TBankInvoiceStatus
  paidAt?: string | null
  paidAmount?: number | null
}

// --- Выписка по счёту ---

/**
 * Нормализованная операция из выписки.
 * Формат ответа Т-Банк местами плавает (см. TODO в getStatementOperations),
 * поэтому нормализуем с фолбэками, а сырой объект сохраняем в raw.
 */
export interface TBankStatementOperation {
  operationId: string
  date: Date | null
  /** Сумма в рублях */
  amount: number
  /** true — входящий платёж (Credit) */
  isCredit: boolean
  payerName: string | null
  payerInn: string | null
  paymentPurpose: string | null
  raw: unknown
}

// --- Ошибки ---

export class TBankApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: unknown
  ) {
    super(message)
    this.name = "TBankApiError"
  }
}

// --- Клиент ---

export class TBankClient {
  private readonly baseUrl: string
  private readonly token: string

  /**
   * @param apiToken Bearer-токен Т-Банк Business API
   * @param sandbox  true = sandbox (тестовый режим), false = production
   */
  constructor(apiToken: string, sandbox: boolean = true) {
    this.token = apiToken
    this.baseUrl = sandbox
      ? "https://business.tbank.ru/openapi/sandbox/api/v1"
      : "https://business.tbank.ru/openapi/api/v1"
  }

  // --- Общий метод запроса ---

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const requestId = crypto.randomUUID()

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      "X-Request-Id": requestId,
    }

    if (body) {
      headers["Content-Type"] = "application/json"
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      let responseBody: unknown
      try {
        responseBody = await res.json()
      } catch {
        responseBody = await res.text().catch(() => null)
      }
      throw new TBankApiError(
        `T-Bank API ${method} ${path} вернул ${res.status}`,
        res.status,
        responseBody
      )
    }

    return res.json() as Promise<T>
  }

  // --- Выставление счёта ---

  /**
   * Создать и отправить счёт через Т-Банк API.
   *
   * POST /api/v1/invoice/send
   * https://developer.tbank.ru/docs/api/post-api-v-1-invoice-send
   *
   * Rate limit: 4 запроса/сек
   */
  async createInvoice(params: CreateInvoiceParams): Promise<CreateInvoiceResult> {
    const body: Record<string, unknown> = {
      invoiceNumber: params.invoiceNumber,
      dueDate: params.dueDate,
      payer: {
        name: params.payer.name,
        inn: params.payer.inn,
        ...(params.payer.kpp ? { kpp: params.payer.kpp } : {}),
      },
      items: params.items.map((item) => ({
        name: item.name,
        price: item.price,
        unit: item.unit,
        vat: item.vat,
        amount: item.amount,
      })),
    }

    if (params.invoiceDate) {
      body.invoiceDate = params.invoiceDate
    }

    if (params.contacts && params.contacts.length > 0) {
      body.contacts = params.contacts
    }

    if (params.comment) {
      body.comment = params.comment
    }

    // TODO: Уточнить точную структуру ответа после тестов в sandbox.
    // Документация указывает invoiceId в ответе (добавлен в релизе 10.11.2022).
    // Поле paymentUrl может отсутствовать — Т-Банк отправляет счёт
    // на email/в ЛК плательщика, а не даёт ссылку для оплаты.
    const response = await this.request<{
      invoiceId?: string
      id?: string
      paymentUrl?: string
      pdfUrl?: string
      incomingInvoiceUrl?: string
    }>("POST", "/invoice/send", body)

    const invoiceId = response.invoiceId || response.id || ""

    return {
      invoiceId,
      paymentUrl: response.incomingInvoiceUrl || response.paymentUrl || null,
      pdfUrl: response.pdfUrl || null,
    }
  }

  // --- Статус счёта ---

  /**
   * Получить статус счёта.
   *
   * GET /api/v1/openapi/invoice/{invoiceId}/info
   * https://developer.tbank.ru/docs/api/get-api-v-1-invoice-invoice-id-info
   *
   * Rate limit: 20 запросов/сек
   */
  async getInvoiceStatus(invoiceId: string): Promise<InvoiceStatusResult> {
    // TODO: Уточнить точный путь — документация показывает два варианта:
    //   /invoice/{invoiceId}/info  и  /openapi/invoice/{invoiceId}/info
    // В sandbox может отличаться. Протестировать оба.
    const response = await this.request<{
      invoiceId?: string
      id?: string
      status?: string
      paidDate?: string
      paidAt?: string
      paidAmount?: number
      amount?: { value?: number }
    }>("GET", `/openapi/invoice/${invoiceId}/info`)

    return {
      invoiceId: response.invoiceId || response.id || invoiceId,
      status: (response.status || "UNKNOWN") as TBankInvoiceStatus,
      paidAt: response.paidDate || response.paidAt || null,
      paidAmount: response.paidAmount ?? response.amount?.value ?? null,
    }
  }

  // --- Выписка по счёту ---

  /**
   * Операции по счёту за период (с курсорной пагинацией).
   *
   * GET /api/v1/statement?accountNumber=...&from=...&till=...
   * https://developer.tbank.ru/docs/api/get-api-v-1-statement
   *
   * Токену нужно право «Выписки» (выпускается в ЛК Т-Бизнеса).
   *
   * TODO: точные имена полей операции проверить в sandbox — в документации
   * встречаются варианты (operationId/id, typeOfOperation/category,
   * payerInn/payer.inn, accountAmount/amount/operationAmount). Парсим
   * дефензивно с фолбэками, сырой объект возвращаем в raw.
   *
   * @param from Дата начала (YYYY-MM-DD)
   * @param till Дата конца (YYYY-MM-DD)
   */
  async getStatementOperations(params: {
    accountNumber: string
    from: string
    till: string
  }): Promise<TBankStatementOperation[]> {
    const operations: TBankStatementOperation[] = []
    let cursor: string | undefined
    // Ограничитель на случай зацикленного курсора
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({
        accountNumber: params.accountNumber,
        from: params.from,
        till: params.till,
        limit: "500",
      })
      if (cursor) qs.set("cursor", cursor)

      const response = await this.request<{
        operations?: Record<string, unknown>[]
        cursor?: string
      }>("GET", `/statement?${qs.toString()}`)

      for (const raw of response.operations || []) {
        operations.push(normalizeStatementOperation(raw))
      }

      if (!response.cursor || (response.operations || []).length === 0) break
      cursor = response.cursor
    }
    return operations
  }
}

/** Нормализация операции выписки с фолбэками по вариантам схемы Т-Банк */
function normalizeStatementOperation(raw: Record<string, unknown>): TBankStatementOperation {
  const s = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null

  const payer = (raw.payer || raw.counterParty || {}) as Record<string, unknown>

  const amountRaw =
    raw.accountAmount ?? raw.operationAmount ?? raw.amount ?? (raw as any)?.amount?.value
  const amount = Number(
    typeof amountRaw === "object" && amountRaw !== null
      ? (amountRaw as any).value
      : amountRaw
  )

  const typeOf = (s(raw.typeOfOperation) || s(raw.operationType) || s(raw.category) || "")
    .toLowerCase()
  const isCredit = typeOf.includes("credit") || typeOf.includes("income")

  const dateStr =
    s(raw.operationDate) || s(raw.date) || s(raw.chargeDate) || s(raw.drawDate)
  const date = dateStr ? new Date(dateStr) : null

  const payerInn = s(raw.payerInn) || s(payer.inn)
  const payerName = s(raw.payerName) || s(payer.name)
  const purpose = s(raw.paymentPurpose) || s(raw.purpose)

  // Идемпотентность требует стабильного ID; если банк его не дал —
  // детерминированный композитный ключ
  const operationId =
    s(raw.operationId) ||
    s(raw.id) ||
    `${dateStr || "?"}|${Number.isFinite(amount) ? amount : "?"}|${payerInn || "?"}|${(purpose || "").slice(0, 60)}`

  return {
    operationId,
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    amount: Number.isFinite(amount) ? amount : 0,
    isCredit,
    payerName,
    payerInn,
    paymentPurpose: purpose,
    raw,
  }
}

// --- Хелпер: создание инстанса ---

let _client: TBankClient | null = null

/**
 * Получить singleton-инстанс TBankClient.
 * Читает TBANK_API_TOKEN и TBANK_SANDBOX из env.
 *
 * @throws Error если TBANK_API_TOKEN не задан
 */
export function getTBankClient(): TBankClient {
  if (_client) return _client

  const token = process.env.TBANK_API_TOKEN
  if (!token) {
    throw new Error(
      "TBANK_API_TOKEN не задан. Добавьте токен в .env или переменные окружения."
    )
  }

  const sandbox = process.env.TBANK_SANDBOX !== "false"
  _client = new TBankClient(token, sandbox)
  return _client
}

// --- Хелпер: формирование счёта для SaaS ---

/**
 * Сформировать параметры счёта для SaaS-подписки.
 *
 * @param invoiceNumber Номер счёта
 * @param amount Сумма (в рублях)
 * @param branchCount Кол-во филиалов
 * @param periodMonths Период (месяцы)
 * @param dueDate Срок оплаты (YYYY-MM-DD)
 * @param payer Данные плательщика
 */
export function buildSaasInvoiceParams(opts: {
  invoiceNumber: string
  amount: number
  branchCount: number
  periodMonths: number
  dueDate: string
  payer: TBankInvoicePayer
  payerEmail?: string
}): CreateInvoiceParams {
  // Единица позиции — месяц доступа: месячная цена уже включает сетку по филиалам
  // и не обязана делиться на branchCount нацело (2 фил. «Стандарт» = 9000, не 2×5000)
  const monthlyPrice = opts.amount / opts.periodMonths

  return {
    invoiceNumber: opts.invoiceNumber,
    dueDate: opts.dueDate,
    payer: opts.payer,
    items: [
      {
        name: `Доступ к SaaS «Умная CRM» (${opts.branchCount} фил., ${opts.periodMonths} мес.)`,
        price: monthlyPrice,
        unit: "мес",
        vat: "None", // АУСН, без НДС
        amount: opts.periodMonths,
      },
    ],
    contacts: opts.payerEmail ? [{ email: opts.payerEmail }] : undefined,
    comment: `Счёт №${opts.invoiceNumber} за SaaS «Умная CRM»`,
  }
}
