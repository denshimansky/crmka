import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"

/**
 * YooKassa webhook handler (FIN-21)
 *
 * Принимает уведомления:
 * - payment.succeeded — успешная оплата
 * - payment.canceled — отмена платежа
 * - refund.succeeded — возврат
 *
 * Идемпотентность: проверяет onlinePaymentId перед созданием Payment.
 * Возвращает 200 быстро — YooKassa повторяет при таймауте.
 *
 * URL: POST /api/webhooks/yookassa?tenant=<tenantId>
 */

// YooKassa IP whitelist (https://yookassa.ru/developers/using-api/webhooks#ip)
const YOOKASSA_IPS = [
  "185.71.76.0/27",
  "185.71.77.0/27",
  "77.75.153.0/25",
  "77.75.156.11",
  "77.75.156.35",
  "77.75.154.128/25",
  "2a02:5180::/32",
]

interface YooKassaPaymentObject {
  id: string
  status: string
  amount: {
    value: string
    currency: string
  }
  description?: string
  metadata?: Record<string, string>
  payment_method?: {
    type: string
  }
  created_at: string
  captured_at?: string
}

interface YooKassaRefundObject {
  id: string
  payment_id: string
  status: string
  amount: {
    value: string
    currency: string
  }
  created_at: string
}

interface YooKassaWebhookBody {
  type: string
  event: string
  object: YooKassaPaymentObject | YooKassaRefundObject
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tenantId = searchParams.get("tenant")

  if (!tenantId) {
    return NextResponse.json({ error: "Missing tenant" }, { status: 400 })
  }

  // Найти интеграцию
  const integration = await db.integrationConfig.findUnique({
    where: { tenantId_provider: { tenantId, provider: "yookassa" } },
  })

  if (!integration || !integration.isActive) {
    return NextResponse.json({ error: "Integration not found or inactive" }, { status: 404 })
  }

  // Верификация по IP (YooKassa рекомендует IP whitelist)
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || ""

  if (!isYooKassaIp(clientIp) && !isDevEnvironment()) {
    console.warn(`[yookassa webhook] Rejected IP: ${clientIp}, tenant: ${tenantId}`)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Верификация по секретному ключу (Basic Auth — shopId:secretKey)
  // YooKassa отправляет webhooks с Basic Auth если настроено
  const webhookSecret = integration.webhookSecret
  if (webhookSecret) {
    const authHeader = req.headers.get("authorization") || ""
    if (!verifyBasicAuth(authHeader, integration.config as IntegrationConfigData, webhookSecret)) {
      console.warn(`[yookassa webhook] Invalid auth for tenant: ${tenantId}`)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  let body: YooKassaWebhookBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const event = body.event
  console.log(`[yookassa webhook] Event: ${event}, tenant: ${tenantId}`)

  try {
    switch (event) {
      case "payment.succeeded":
        await handlePaymentSucceeded(body.object as YooKassaPaymentObject, tenantId, integration.config as IntegrationConfigData)
        break

      case "payment.canceled":
        // Логируем, но не создаём Payment — оплата не прошла
        console.log(`[yookassa webhook] Payment canceled: ${body.object.id}, tenant: ${tenantId}`)
        break

      case "refund.succeeded":
        await handleRefundSucceeded(body.object as YooKassaRefundObject, tenantId, integration.config as IntegrationConfigData)
        break

      default:
        console.log(`[yookassa webhook] Unknown event: ${event}, tenant: ${tenantId}`)
    }
  } catch (error) {
    console.error(`[yookassa webhook] Error processing ${event}:`, error)
    // Возвращаем 200 чтобы YooKassa не повторяла — ошибка на нашей стороне
    // Если вернуть 5xx, YooKassa будет повторять до 24ч
    return NextResponse.json({ ok: true, error: "internal" })
  }

  return NextResponse.json({ ok: true })
}

// === Обработчики событий ===

async function handlePaymentSucceeded(
  payment: YooKassaPaymentObject,
  tenantId: string,
  config: IntegrationConfigData,
) {
  const yookassaPaymentId = payment.id

  // Идемпотентность: проверяем, не обработан ли уже этот платёж
  const existing = await db.payment.findFirst({
    where: {
      tenantId,
      onlinePaymentId: yookassaPaymentId,
      deletedAt: null,
    },
  })
  if (existing) {
    console.log(`[yookassa webhook] Payment already processed: ${yookassaPaymentId}`)
    return
  }

  const amount = parseFloat(payment.amount.value)
  if (isNaN(amount) || amount <= 0) {
    console.error(`[yookassa webhook] Invalid amount: ${payment.amount.value}`)
    return
  }

  const metadata = payment.metadata || {}
  const clientId = metadata.clientId
  const subscriptionId = metadata.subscriptionId || undefined
  const accountId = metadata.accountId || config.defaultAccountId

  if (!clientId) {
    console.error(`[yookassa webhook] Missing clientId in metadata, payment: ${yookassaPaymentId}`)
    return
  }

  // Проверяем клиента
  const client = await db.client.findFirst({
    where: { id: clientId, tenantId, deletedAt: null },
  })
  if (!client) {
    console.error(`[yookassa webhook] Client not found: ${clientId}, tenant: ${tenantId}`)
    return
  }

  // Проверяем счёт
  if (!accountId) {
    console.error(`[yookassa webhook] No accountId in metadata and no defaultAccountId in config, tenant: ${tenantId}`)
    return
  }

  const account = await db.financialAccount.findFirst({
    where: { id: accountId, tenantId, deletedAt: null },
  })
  if (!account) {
    console.error(`[yookassa webhook] Account not found: ${accountId}, tenant: ${tenantId}`)
    return
  }

  // Проверяем абонемент если указан
  if (subscriptionId) {
    const sub = await db.subscription.findFirst({
      where: { id: subscriptionId, tenantId, clientId, deletedAt: null },
    })
    if (!sub) {
      console.error(`[yookassa webhook] Subscription not found: ${subscriptionId}`)
      // Создаём оплату без абонемента
    }
  }

  // Первая ли оплата клиента?
  const priorPayments = await db.payment.count({
    where: { clientId, tenantId, deletedAt: null },
  })
  const isFirstPayment = priorPayments === 0

  const paymentDate = payment.captured_at
    ? new Date(payment.captured_at)
    : new Date(payment.created_at)

  // Создаём оплату и обновляем связанные сущности в транзакции
  await db.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        tenantId,
        clientId,
        accountId,
        subscriptionId: subscriptionId || null,
        amount,
        type: "incoming",
        method: "online_yukassa",
        date: paymentDate,
        onlinePaymentId: yookassaPaymentId,
        comment: payment.description || "Онлайн-оплата ЮKassa",
        isFirstPayment,
      },
    })

    // Обновляем баланс счёта
    await tx.financialAccount.update({
      where: { id: accountId },
      data: { balance: { increment: amount } },
    })

    // Обновляем баланс клиента
    await tx.client.update({
      where: { id: clientId },
      data: { clientBalance: { increment: amount } },
    })

    // Если привязан абонемент — уменьшаем остаток и активируем если pending
    if (subscriptionId) {
      const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } })
      if (sub) {
        const updateSubData: Prisma.SubscriptionUpdateInput = {
          balance: { decrement: amount },
        }
        if (sub.status === "pending") {
          updateSubData.status = "active"
          updateSubData.activatedAt = new Date()
        }
        await tx.subscription.update({
          where: { id: subscriptionId },
          data: updateSubData,
        })
      }
    }

    // Если первая оплата — переводим клиента в active_client
    if (isFirstPayment) {
      await tx.client.update({
        where: { id: clientId },
        data: {
          funnelStatus: "active_client",
          clientStatus: "active",
          firstPaymentDate: paymentDate,
          saleDate: paymentDate,
        },
      })
    }
  })

  console.log(`[yookassa webhook] Payment created: ${yookassaPaymentId}, amount: ${amount}, client: ${clientId}`)
}

async function handleRefundSucceeded(
  refund: YooKassaRefundObject,
  tenantId: string,
  config: IntegrationConfigData,
) {
  const refundId = `refund_${refund.id}`

  // Идемпотентность
  const existing = await db.payment.findFirst({
    where: {
      tenantId,
      onlinePaymentId: refundId,
      deletedAt: null,
    },
  })
  if (existing) {
    console.log(`[yookassa webhook] Refund already processed: ${refund.id}`)
    return
  }

  // Находим оригинальный платёж по payment_id
  const originalPayment = await db.payment.findFirst({
    where: {
      tenantId,
      onlinePaymentId: refund.payment_id,
      deletedAt: null,
    },
  })

  if (!originalPayment) {
    console.error(`[yookassa webhook] Original payment not found for refund: ${refund.payment_id}`)
    return
  }

  const amount = parseFloat(refund.amount.value)
  if (isNaN(amount) || amount <= 0) {
    console.error(`[yookassa webhook] Invalid refund amount: ${refund.amount.value}`)
    return
  }

  await db.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        tenantId,
        clientId: originalPayment.clientId,
        accountId: originalPayment.accountId,
        subscriptionId: originalPayment.subscriptionId,
        amount: new Prisma.Decimal(amount),
        type: "refund",
        method: "online_yukassa",
        date: new Date(refund.created_at),
        onlinePaymentId: refundId,
        comment: `Возврат по платежу ${refund.payment_id}`,
        isFirstPayment: false,
      },
    })

    // Уменьшаем баланс счёта
    await tx.financialAccount.update({
      where: { id: originalPayment.accountId },
      data: { balance: { decrement: amount } },
    })

    // Уменьшаем баланс клиента
    await tx.client.update({
      where: { id: originalPayment.clientId },
      data: { clientBalance: { decrement: amount } },
    })

    // Если был абонемент — увеличиваем долг обратно
    if (originalPayment.subscriptionId) {
      await tx.subscription.update({
        where: { id: originalPayment.subscriptionId },
        data: { balance: { increment: amount } },
      })
    }
  })

  console.log(`[yookassa webhook] Refund created: ${refund.id}, amount: ${amount}`)
}

// === Вспомогательные функции ===

interface IntegrationConfigData {
  shopId?: string
  secretKey?: string
  defaultAccountId?: string
}

function verifyBasicAuth(
  authHeader: string,
  config: IntegrationConfigData,
  webhookSecret: string,
): boolean {
  if (!authHeader.startsWith("Basic ")) return false
  try {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8")
    const [user, pass] = decoded.split(":")
    // YooKassa шлёт shopId:secretKey
    return user === config.shopId && pass === webhookSecret
  } catch {
    return false
  }
}

function isDevEnvironment(): boolean {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
}

/**
 * Проверяет IP по списку YooKassa.
 * Поддерживает CIDR и отдельные IP (только IPv4).
 */
function isYooKassaIp(ip: string): boolean {
  if (!ip) return false
  for (const range of YOOKASSA_IPS) {
    if (range.includes("/")) {
      if (isIpInCidr(ip, range)) return true
    } else {
      if (ip === range) return true
    }
  }
  return false
}

function isIpInCidr(ip: string, cidr: string): boolean {
  // Пропускаем IPv6 CIDR при проверке IPv4 адреса
  if (cidr.includes(":")) return false

  const [rangeIp, prefixStr] = cidr.split("/")
  const prefix = parseInt(prefixStr, 10)

  const ipNum = ipToNumber(ip)
  const rangeNum = ipToNumber(rangeIp)
  if (ipNum === null || rangeNum === null) return false

  const mask = ~((1 << (32 - prefix)) - 1) >>> 0
  return (ipNum & mask) === (rangeNum & mask)
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  let num = 0
  for (const part of parts) {
    const n = parseInt(part, 10)
    if (isNaN(n) || n < 0 || n > 255) return null
    num = (num << 8) + n
  }
  return num >>> 0
}
