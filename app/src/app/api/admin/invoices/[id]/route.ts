import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import {
  applyInvoicePaymentById,
  removeInvoiceNotifications,
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
  } else if (parsed.data.status) {
    data.status = parsed.data.status
    if (parsed.data.status === "cancelled") {
      await removeInvoiceNotifications(id, existing.organizationId)
    }
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
