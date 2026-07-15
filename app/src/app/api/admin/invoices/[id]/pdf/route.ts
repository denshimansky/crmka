import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { renderInvoicePdf } from "@/lib/billing/invoice-pdf"

export const runtime = "nodejs"

// GET /api/admin/invoices/[id]/pdf — PDF счёта из бэк-офиса (любая админ-роль)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const invoice = await db.billingInvoice.findUnique({
    where: { id },
    include: { organization: { select: { name: true, legalName: true, inn: true } } },
  })
  if (!invoice) {
    return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })
  }

  const pdf = await renderInvoicePdf({
    number: invoice.number,
    issueDate: invoice.createdAt,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    amount: Number(invoice.amount),
    periodMonths: invoice.periodMonths,
    branchCount: invoice.branchCount,
    customer: {
      legalName: invoice.organization.legalName || invoice.organization.name,
      // В админке ИНН может быть не заполнен — рендерим с прочерком
      inn: invoice.organization.inn || "—",
    },
  })

  const filename = `schet-${invoice.number}.pdf`
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
