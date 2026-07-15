import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { renderInvoicePdf } from "@/lib/billing/invoice-pdf"

export const runtime = "nodejs"

// GET /api/billing/invoices/[id]/pdf — PDF счёта-договора оферты (ЛК партнёра).
// Доступ: owner, manager своей организации. Открывается во вкладке (inline).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json(
      { error: "Доступ только для владельца и управляющего" },
      { status: 403 }
    )
  }

  const tenantId = (session.user as any).tenantId
  const { id } = await params

  const invoice = await db.billingInvoice.findFirst({
    where: { id, organizationId: tenantId },
    include: { organization: { select: { name: true, legalName: true, inn: true } } },
  })
  if (!invoice) {
    return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })
  }
  if (!invoice.organization.inn) {
    return NextResponse.json(
      { error: "У организации не заполнен ИНН — обратитесь в поддержку" },
      { status: 422 }
    )
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
      inn: invoice.organization.inn,
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
