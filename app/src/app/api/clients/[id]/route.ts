import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  patronymic: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  phone: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  phone2: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  email: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null).pipe(z.string().email("Некорректный email").nullable()),
  socialLink: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  funnelStatus: z.enum(["new", "trial_scheduled", "trial_attended", "awaiting_payment", "active_client", "potential", "non_target", "blacklisted", "archived"]).optional(),
  clientStatus: z.enum(["active", "upsell", "churned", "returning", "archived"]).nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  nextContactDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  blacklistReason: z.string().optional(),
  promisedPaymentDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const client = await db.client.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
    include: {
      wards: true,
      branch: { select: { id: true, name: true } },
      assignee: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  return NextResponse.json(client)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const existing = await db.client.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  // Нельзя вернуть клиента в лида
  if (existing.clientStatus === "active" && data.funnelStatus && data.funnelStatus !== "active_client") {
    return NextResponse.json({ error: "Нельзя вернуть активного клиента в воронку лидов" }, { status: 400 })
  }

  const client = await db.client.update({
    where: { id },
    data: {
      ...(data.firstName !== undefined && { firstName: data.firstName }),
      ...(data.lastName !== undefined && { lastName: data.lastName }),
      ...(data.patronymic !== undefined && { patronymic: data.patronymic }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.phone2 !== undefined && { phone2: data.phone2 }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.socialLink !== undefined && { socialLink: data.socialLink }),
      ...(data.funnelStatus && { funnelStatus: data.funnelStatus }),
      ...(data.clientStatus !== undefined && { clientStatus: data.clientStatus }),
      ...(data.branchId !== undefined && { branchId: data.branchId }),
      ...(data.assignedTo !== undefined && { assignedTo: data.assignedTo }),
      ...(data.comment !== undefined && { comment: data.comment }),
      ...(data.nextContactDate !== undefined && { nextContactDate: data.nextContactDate ? new Date(data.nextContactDate) : null }),
      ...(data.blacklistReason && { blacklistReason: data.blacklistReason, blacklistedBy: session.user.employeeId }),
      ...(data.promisedPaymentDate !== undefined && { promisedPaymentDate: data.promisedPaymentDate ? new Date(data.promisedPaymentDate) : null }),
    },
    include: { wards: true, branch: { select: { id: true, name: true } } },
  })

  return NextResponse.json(client)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  await db.client.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
