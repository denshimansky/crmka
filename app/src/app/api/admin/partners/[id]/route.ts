import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { z } from "zod"

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

  const updated = await db.organization.update({ where: { id }, data })
  return NextResponse.json(updated)
}
