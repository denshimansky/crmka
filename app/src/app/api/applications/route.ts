import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { rateLimitTenant } from "@/lib/rate-limit"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import {
  branchScopeFromSession,
  canAccessBranch,
  scopeApplication,
} from "@/lib/branch-scope"

const createSchema = z.object({
  clientId: z.string().uuid("Не указан клиент"),
  wardId: z.string().uuid("Не выбран подопечный"),
  branchId: z.string().uuid("Не выбран филиал"),
  directionId: z.string().uuid("Не выбрано направление"),
  comment: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get("clientId")
  const status = searchParams.get("status")

  const where: Prisma.ApplicationWhereInput = {
    tenantId: session.user.tenantId,
    deletedAt: null,
  }
  if (clientId) where.clientId = clientId
  if (status === "active" || status === "processed") where.status = status

  // ADM-04: серверный фильтр по филиалам сессии.
  const allowedBranchIds = (session.user as any).allowedBranchIds as string[] | null | undefined
  const scope = branchScopeFromSession(allowedBranchIds)
  const scopeFilter = scopeApplication(scope)
  const finalWhere: Prisma.ApplicationWhereInput =
    Object.keys(scopeFilter).length > 0 ? { AND: [where, scopeFilter] } : where

  const applications = await db.application.findMany({
    where: finalWhere,
    include: {
      ward: { select: { id: true, firstName: true, lastName: true } },
      branch: { select: { id: true, name: true } },
      direction: { select: { id: true, name: true, color: true } },
      processor: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(applications)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rl = rateLimitTenant(session.user.tenantId)
  if (!rl.ok) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 })

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data
  const tenantId = session.user.tenantId

  const [client, ward, branch, direction] = await Promise.all([
    db.client.findFirst({
      where: { id: data.clientId, tenantId, deletedAt: null },
      select: { id: true, funnelStatus: true },
    }),
    db.ward.findFirst({ where: { id: data.wardId, clientId: data.clientId, tenantId }, select: { id: true } }),
    db.branch.findFirst({ where: { id: data.branchId, tenantId, deletedAt: null }, select: { id: true } }),
    db.direction.findFirst({ where: { id: data.directionId, tenantId, deletedAt: null }, select: { id: true } }),
  ])
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  if (client.funnelStatus === "archived" || client.funnelStatus === "blacklisted") {
    return NextResponse.json(
      { error: "Клиент в архиве/ЧС — снимите статус, чтобы создать заявку." },
      { status: 403 },
    )
  }
  if (!ward) return NextResponse.json({ error: "Подопечный не найден" }, { status: 404 })
  if (!branch) return NextResponse.json({ error: "Филиал не найден" }, { status: 404 })
  if (!direction) return NextResponse.json({ error: "Направление не найдено" }, { status: 404 })

  // ADM-04: создавать заявку можно только в свой филиал.
  const allowedBranchIds = (session.user as any).allowedBranchIds as string[] | null | undefined
  const scope = branchScopeFromSession(allowedBranchIds)
  if (!canAccessBranch(data.branchId, scope)) {
    return NextResponse.json(
      { error: "Нет доступа к этому филиалу" },
      { status: 403 },
    )
  }

  // Запрет дублей заявок (баг #52): у одного подопечного не должно быть двух
  // активных заявок с одинаковой парой (филиал, направление). Группа в схеме
  // Application не хранится, поэтому проверяем только эти два поля.
  const duplicateApp = await db.application.findFirst({
    where: {
      tenantId,
      wardId: data.wardId,
      branchId: data.branchId,
      directionId: data.directionId,
      status: "active",
      deletedAt: null,
    },
    select: { id: true },
  })
  if (duplicateApp) {
    return NextResponse.json(
      { error: "У подопечного уже есть активная заявка на этот филиал и направление." },
      { status: 409 },
    )
  }

  const application = await db.$transaction(async (tx) => {
    const created = await tx.application.create({
      data: {
        tenantId,
        clientId: data.clientId,
        wardId: data.wardId,
        branchId: data.branchId,
        directionId: data.directionId,
        comment: data.comment,
        createdBy: session.user.employeeId ?? undefined,
      },
      include: {
        ward: { select: { id: true, firstName: true, lastName: true } },
        branch: { select: { id: true, name: true } },
        direction: { select: { id: true, name: true, color: true } },
      },
    })
    // Воронка продаж по подопечному — после оплаты или ручного перевода она будет другой,
    // но новая заявка всегда поднимает Ward в стадию «Заявка», если он ещё в none.
    await tx.ward.updateMany({
      where: { id: data.wardId, salesStage: "none" },
      data: { salesStage: "application", salesStageAt: new Date() },
    })
    return created
  })

  if (session.user.employeeId) {
    await db.auditLog.create({
      data: {
        tenantId,
        employeeId: session.user.employeeId,
        action: "create",
        entityType: "Application",
        entityId: application.id,
        changes: {
          wardId: { old: null, new: data.wardId },
          branchId: { old: null, new: data.branchId },
          directionId: { old: null, new: data.directionId },
        },
      },
    })
  }

  return NextResponse.json(application, { status: 201 })
}
