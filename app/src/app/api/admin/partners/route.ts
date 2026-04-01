import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { z } from "zod"

// GET /api/admin/partners — список партнёров
export async function GET() {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const partners = await db.organization.findMany({
    include: {
      branches: { where: { deletedAt: null }, select: { id: true, name: true } },
      employees: { where: { role: "owner", deletedAt: null }, select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      billingSubscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { plan: { select: { name: true } } },
      },
      _count: {
        select: {
          employees: { where: { deletedAt: null } },
          clients: { where: { deletedAt: null } },
          branches: { where: { deletedAt: null } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(partners)
}

const createSchema = z.object({
  name: z.string({ required_error: "Название обязательно" }).min(1, "Название обязательно"),
  legalName: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  inn: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  phone: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  email: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  contactPerson: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

// POST /api/admin/partners — создать партнёра
export async function POST(req: NextRequest) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin" && session.role !== "billing") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const org = await db.organization.create({
    data: {
      name: parsed.data.name,
      legalName: parsed.data.legalName,
      inn: parsed.data.inn,
      phone: parsed.data.phone,
      email: parsed.data.email,
      contactPerson: parsed.data.contactPerson,
    },
  })

  return NextResponse.json(org, { status: 201 })
}
