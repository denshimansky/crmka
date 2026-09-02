import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import {
  applyInvoicePaymentById,
  cancelInvoice,
  cancelInvoiceById,
} from "@/lib/billing/apply-invoice-payment"
import { z } from "zod"

// PATCH /api/admin/invoices/[id] — обновить статус счёта
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin" && session.role !== "billing") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()

  const schema = z.object({
    status: z.enum(["pending", "paid", "overdue", "cancelled"]).optional(),
    paidAmount: z.number().min(0).optional(),
    comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  })

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const existing = await db.billingInvoice.findUnique({
    where: { id },
    include: { subscription: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })
  }

  const data: Record<string, unknown> = {}
  if (parsed.data.comment !== undefined) data.comment = parsed.data.comment

  if (parsed.data.status === "paid") {
    // Оплата: счёт → paid, подписка → продление, организация → разблокировка,
    // уведомления «оплатите счёт» → удаляются (общий хелпер)
    await applyInvoicePaymentById({
      invoiceId: id,
      paidVia: "manual",
      paidAmount: parsed.data.paidAmount,
    })
  } else if (parsed.data.status === "cancelled") {
    // Отмена: статус + возврат учтённого кредита + скрытие уведомлений (хелпер)
    await cancelInvoiceById(id)
  } else if (parsed.data.status) {
    data.status = parsed.data.status
  }

  const updated = Object.keys(data).length
    ? await db.billingInvoice.update({
        where: { id },
        data,
        include: { organization: { select: { name: true } } },
      })
    : await db.billingInvoice.findUnique({
        where: { id },
        include: { organization: { select: { name: true } } },
      })

  return NextResponse.json(updated)
}

// DELETE /api/admin/invoices/[id] — удалить счёт безвозвратно
//
// Строка удаляется из billing_invoices, поэтому счёт исчезает отовсюду разом:
// список счетов, дашборд бэк-офиса, карточка партнёра, ЛК партнёра, PDF.
// Перед удалением прогоняем обычную отмену (cancelInvoice): вернуть учтённый
// кредит, снять блокировку, если это был последний долг действующего партнёра,
// и убрать «оплатите счёт» из колокольчика. Факт удаления пишем в AuditLog —
// самой строки счёта уже не будет.
//
// Оплаченный счёт удаляется тоже (на это предупреждает подтверждение в UI):
// оплата пропадёт из отчётов, но оплаченный период подписки НЕ откатывается.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin" && session.role !== "billing") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params

  const invoice = await db.billingInvoice.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      amount: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      paidAt: true,
      organizationId: true,
      organization: { select: { name: true } },
    },
  })
  if (!invoice) {
    return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })
  }

  await db.$transaction(async (tx) => {
    await cancelInvoice(tx, id)

    // Уведомления по счёту — на случай отменённого ранее счёта, где cancelInvoice
    // выходит сразу (тип не ограничиваем: чистим всё, что ссылается на счёт).
    await tx.notification.deleteMany({
      where: { tenantId: invoice.organizationId, entityType: "BillingInvoice", entityId: id },
    })

    await tx.auditLog.create({
      data: {
        tenantId: invoice.organizationId,
        action: "delete",
        entityType: "BillingInvoice",
        entityId: id,
        changes: {
          number: invoice.number,
          amount: Number(invoice.amount),
          status: invoice.status,
          periodStart: invoice.periodStart.toISOString().slice(0, 10),
          periodEnd: invoice.periodEnd.toISOString().slice(0, 10),
          paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
          organization: invoice.organization.name,
          adminEmail: session.email,
        },
      },
    })

    await tx.billingInvoice.delete({ where: { id } })
  })

  return NextResponse.json({ ok: true })
}
