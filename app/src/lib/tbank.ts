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
  const pricePerUnit = opts.amount / (opts.branchCount * opts.periodMonths)

  return {
    invoiceNumber: opts.invoiceNumber,
    dueDate: opts.dueDate,
    payer: opts.payer,
    items: [
      {
        name: `Доступ к SaaS «Умная CRM» (${opts.branchCount} фил., ${opts.periodMonths} мес.)`,
        price: pricePerUnit,
        unit: "мес",
        vat: "None", // АУСН, без НДС
        amount: opts.branchCount * opts.periodMonths,
      },
    ],
    contacts: opts.payerEmail ? [{ email: opts.payerEmail }] : undefined,
    comment: `Счёт №${opts.invoiceNumber} за SaaS «Умная CRM»`,
  }
}
