import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { ensureOrgLegalName } from "@/lib/billing/checko"
import { cancelOutstandingInvoices } from "@/lib/billing/apply-invoice-payment"

// GET /api/admin/partners/[id] — карточка партнёра
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const partner = await db.organization.findUnique({
    where: { id },
    include: {
      branches: { where: { deletedAt: null } },
      employees: {
        where: { deletedAt: null },
        select: { id: true, firstName: true, lastName: true, role: true, email: true, phone: true, isActive: true },
        orderBy: { role: "asc" },
      },
      billingSubscriptions: {
        orderBy: { createdAt: "desc" },
        include: {
          plan: true,
          invoices: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      },
      billingInvoices: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      _count: {
        select: {
          employees: { where: { deletedAt: null } },
          clients: { where: { deletedAt: null } },
          branches: { where: { deletedAt: null } },
        },
      },
    },
  })

  if (!partner) {
    return NextResponse.json({ error: "Партнёр не найден" }, { status: 404 })
  }

  return NextResponse.json(partner)
}

const updateSchema = z.object({
  name: z.string().min(1, "Название обязательно").optional(),
  legalName: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  inn: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  phone: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  email: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  contactPerson: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  billingStatus: z.enum(["active", "grace_period", "blocked"]).optional(),
  billingExempt: z.boolean().optional(),
  // Архивирование партнёра (former partner). true → archivedAt = now, false → NULL.
  archived: z.boolean().optional(),
})

// PATCH /api/admin/partners/[id] — обновить партнёра
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin" && session.role !== "billing") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) data.name = parsed.data.name
  if (parsed.data.legalName !== undefined) data.legalName = parsed.data.legalName
  if (parsed.data.inn !== undefined) data.inn = parsed.data.inn
  if (parsed.data.phone !== undefined) data.phone = parsed.data.phone
  if (parsed.data.email !== undefined) data.email = parsed.data.email
  if (parsed.data.contactPerson !== undefined) data.contactPerson = parsed.data.contactPerson
  if (parsed.data.billingStatus !== undefined) data.billingStatus = parsed.data.billingStatus
  if (parsed.data.billingExempt !== undefined) data.billingExempt = parsed.data.billingExempt
  // Архив: штампуем/снимаем метку времени (обратимо). Сам архив только гасит
  // биллинг и уводит партнёра вниз списка — подписку/данные не трогаем.
  if (parsed.data.archived !== undefined) data.archivedAt = parsed.data.archived ? new Date() : null

  // Архивирование = биллинг выключен полностью. Кроны новых счетов архивным уже
  // не выставляют, но ранее выставленные висели в ЛК и в колокольчике («оплатите
  // счёт») и попадали в отчёты как долг — поэтому неоплаченные счета снимаем
  // здесь же. Порядок важен: сперва проставляем archivedAt, тогда отмена долга
  // не разблокирует бывшего партнёра (см. cancelInvoice).
  // Возврат из архива — зеркально: если непогашенных просрочек не осталось,
  // снимаем блокировку, иначе партнёр завис бы в read-only без счёта к оплате.
  let cancelledInvoices = 0
  const updated = await db.$transaction(async (tx) => {
    const org = await tx.organization.update({ where: { id }, data })

    if (parsed.data.archived === true) {
      cancelledInvoices = await cancelOutstandingInvoices(tx, id)
    } else if (parsed.data.archived === false && org.billingStatus !== "active") {
      const overdue = await tx.billingInvoice.count({
        where: { organizationId: id, status: "overdue" },
      })
      if (overdue === 0) {
        await tx.organization.update({ where: { id }, data: { billingStatus: "active" } })
        // Только заблокированные/грейсовые: триальную подписку «активной» не делаем.
        await tx.billingSubscription.updateMany({
          where: { organizationId: id, status: { in: ["blocked", "grace_period"] } },
          data: { status: "active", blockedAt: null, gracePeriodEnd: null },
        })
        org.billingStatus = "active"
      }
    }

    return org
  })

  // Если у партнёра есть ИНН, но юр. наименование не задано вручную — подтягиваем
  // официальное название из ЕГРЮЛ/ЕГРИП (checko), чтобы оно попало в счёт.
  // Best-effort: не задерживаем ответ ошибкой checko.
  if ((!updated.legalName || !updated.legalName.trim()) && updated.inn?.trim()) {
    try {
      const name = await ensureOrgLegalName({
        id: updated.id,
        inn: updated.inn,
        legalName: updated.legalName,
      })
      if (name) updated.legalName = name
    } catch {
      // игнорируем — реквизиты можно заполнить вручную
    }
  }

  return NextResponse.json({ ...updated, cancelledInvoices })
}
