import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { rateLimitTenant } from "@/lib/rate-limit"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { z } from "zod"
import { Prisma } from "@prisma/client"

const createSchema = z.object({
  firstName: z.string().min(1, "Имя обязательно").optional(),
  lastName: z.string().min(1, "Фамилия обязательна").optional(),
  patronymic: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  phone: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  phone2: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  email: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined).pipe(z.string().email("Некорректный email").optional()),
  socialLink: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  funnelStatus: z.enum(["new", "trial_scheduled", "trial_attended", "awaiting_payment", "active_client", "potential", "non_target", "blacklisted", "archived"]).default("new"),
  clientStatus: z.enum(["active", "upsell", "churned", "returning", "archived"]).nullable().optional(),
  branchId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  nextContactDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  // Подопечные при создании
  wards: z.array(z.object({
    firstName: z.string().min(1, "Имя подопечного обязательно"),
    lastName: z.string().optional(),
    birthDate: z.string().optional(),
    notes: z.string().optional(),
  })).optional(),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") // (legacy) active, lead, churned, all
  const tab = searchParams.get("tab") // leads, potential, nontarget, active, churned, archived, blacklist, all
  const search = searchParams.get("search")
  const segment = searchParams.get("segment")
  const branchId = searchParams.get("branchId")

  const where: Prisma.ClientWhereInput = {
    tenantId: session.user.tenantId,
    deletedAt: null,
  }

  const noActiveApplication: Prisma.ClientWhereInput = {
    applications: { none: { status: "active", deletedAt: null } },
  }

  if (tab) {
    if (tab === "leads") {
      where.funnelStatus = "new"
      where.AND = [noActiveApplication, { payments: { none: {} } }]
    } else if (tab === "potential") {
      where.funnelStatus = "potential"
      where.AND = [noActiveApplication]
    } else if (tab === "nontarget") {
      where.funnelStatus = "non_target"
    } else if (tab === "active") {
      where.AND = [
        { subscriptions: { some: { status: "active", deletedAt: null } } },
        noActiveApplication,
        { funnelStatus: { notIn: ["archived", "blacklisted"] } },
      ]
    } else if (tab === "churned") {
      where.clientStatus = "churned"
      where.subscriptions = { none: { status: "active", deletedAt: null } }
    } else if (tab === "archived") {
      where.funnelStatus = "archived"
    } else if (tab === "blacklist") {
      where.funnelStatus = "blacklisted"
    }
    // tab === "all" — без дополнительных фильтров
  } else if (status === "active") {
    where.clientStatus = "active"
  } else if (status === "lead") {
    where.clientStatus = null
    where.funnelStatus = { notIn: ["active_client", "archived"] }
  } else if (status === "churned") {
    where.clientStatus = "churned"
  }

  // Поиск-по-токенам: каждое слово запроса должно совпасть с одним из полей
  // (имя/фамилия/телефон/email). Без этого «Фамилия Имя» не находилось,
  // потому что в одном поле такой подстроки нет.
  if (search) {
    const tokens = search.split(/\s+/).map((t) => t.trim()).filter(Boolean)
    if (tokens.length === 1) {
      const t = tokens[0]
      where.OR = [
        { firstName: { contains: t, mode: "insensitive" } },
        { lastName: { contains: t, mode: "insensitive" } },
        { phone: { contains: t } },
        { email: { contains: t, mode: "insensitive" } },
      ]
    } else if (tokens.length > 1) {
      where.AND = [
        ...((where.AND as Prisma.ClientWhereInput[] | undefined) ?? []),
        ...tokens.map((t) => ({
          OR: [
            { firstName: { contains: t, mode: "insensitive" as const } },
            { lastName: { contains: t, mode: "insensitive" as const } },
            { phone: { contains: t } },
          ],
        })),
      ]
    }
  }

  if (segment) {
    where.segment = segment as any
  }

  if (branchId) {
    where.branchId = branchId
  }

  const clients = await db.client.findMany({
    where,
    include: {
      wards: true,
      branch: { select: { id: true, name: true } },
      assignee: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  // Маскирование телефонов для роли «инструктор» — жёсткая политика.
  const role = session.user.role
  const masked = clients.map((c) => ({
    ...c,
    phone: maskPhone(c.phone, role),
    phone2: maskPhone(c.phone2, role),
  }))

  return NextResponse.json(masked)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Tenant rate limiting (L-1 audit fix)
  const rl = rateLimitTenant(session.user.tenantId)
  if (!rl.ok) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 })

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Хотя бы телефон или соцсеть
  if (!data.phone && !data.socialLink) {
    return NextResponse.json({ error: "Укажите телефон или ссылку на соцсеть" }, { status: 400 })
  }

  // Автоназначение ответственного: если не указан — создатель (если он сотрудник)
  const assignedTo = data.assignedTo ?? session.user.employeeId ?? undefined

  const client = await db.client.create({
    data: {
      tenantId: session.user.tenantId,
      firstName: data.firstName,
      lastName: data.lastName,
      patronymic: data.patronymic,
      phone: data.phone,
      phone2: data.phone2,
      email: data.email,
      socialLink: data.socialLink,
      funnelStatus: data.funnelStatus,
      clientStatus: data.clientStatus,
      branchId: data.branchId,
      channelId: data.channelId,
      assignedTo,
      comment: data.comment,
      nextContactDate: data.nextContactDate ? new Date(data.nextContactDate) : undefined,
      createdBy: session.user.employeeId,
      wards: data.wards?.length ? {
        create: data.wards.map(w => ({
          tenantId: session.user.tenantId,
          firstName: w.firstName,
          lastName: w.lastName,
          birthDate: w.birthDate ? new Date(w.birthDate) : undefined,
          notes: w.notes,
        })),
      } : undefined,
    },
    include: { wards: true, branch: { select: { id: true, name: true } } },
  })

  return NextResponse.json(client, { status: 201 })
}
