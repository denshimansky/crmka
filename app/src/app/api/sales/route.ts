import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma, WardSalesStage } from "@prisma/client"

const TAB_VALUES = ["application", "trial", "trial_done", "awaiting_payment"] as const
type SalesTab = (typeof TAB_VALUES)[number]

const TAB_TO_STAGE: Record<Exclude<SalesTab, "application">, WardSalesStage> = {
  trial: "trial_scheduled",
  trial_done: "trial_attended",
  awaiting_payment: "awaiting_payment",
}

function notArchivedClient(branchId?: string): Prisma.ClientWhereInput {
  return {
    deletedAt: null,
    funnelStatus: { notIn: ["archived", "blacklisted"] },
    ...(branchId ? { branchId } : {}),
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const tab = (searchParams.get("tab") || "application") as SalesTab
  const branchId = searchParams.get("branchId") || undefined
  const tenantId = session.user.tenantId

  if (!TAB_VALUES.includes(tab)) {
    return NextResponse.json({ error: "Неизвестная вкладка" }, { status: 400 })
  }

  const clientInclude = {
    id: true,
    firstName: true,
    lastName: true,
    phone: true,
    socialLink: true,
    nextContactDate: true,
    comment: true,
    createdAt: true,
    funnelStatus: true,
    clientStatus: true,
    firstPaidLessonDate: true,
    channel: { select: { id: true, name: true } },
    assignee: { select: { id: true, firstName: true, lastName: true } },
    _count: { select: { payments: true } },
  } as const

  if (tab === "application") {
    // Источник — Ward.salesStage='application' (как у остальных вкладок).
    // Active Application подтягивается как опциональная связь — без неё ребёнок
    // всё равно отображается в «Заявке».
    const rows = await db.ward.findMany({
      where: {
        tenantId,
        salesStage: "application",
        client: notArchivedClient(branchId),
      },
      include: {
        client: { select: { ...clientInclude, branch: { select: { id: true, name: true } } } },
        applications: {
          where: { status: "active", deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            branch: { select: { id: true, name: true } },
            direction: { select: { id: true, name: true, color: true } },
          },
        },
      },
      orderBy: { salesStageAt: "desc" },
    })
    return NextResponse.json(rows)
  }

  // trial / trial_done / awaiting_payment — по подопечному
  const stage = TAB_TO_STAGE[tab]
  const trialLessonFilter =
    tab === "trial" ? { status: "scheduled" as const } : { status: "attended" as const }
  const trialLessonOrder =
    tab === "trial" ? ({ scheduledDate: "asc" as const }) : ({ attendedAt: "desc" as const })

  const wards = await db.ward.findMany({
    where: {
      tenantId,
      salesStage: stage,
      client: notArchivedClient(branchId),
    },
    include: {
      client: { select: { ...clientInclude, branch: { select: { id: true, name: true } } } },
      trialLessons: {
        where: trialLessonFilter,
        orderBy: trialLessonOrder,
        take: 1,
        include: {
          group: {
            select: {
              id: true,
              name: true,
              branch: { select: { id: true, name: true } },
              direction: { select: { id: true, name: true, color: true, lessonPrice: true } },
            },
          },
          direction: { select: { id: true, name: true, color: true, lessonPrice: true } },
          room: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
          instructor: { select: { id: true, firstName: true, lastName: true } },
          lesson: { select: { startTime: true } },
        },
      },
    },
    orderBy: tab === "trial" ? { salesStageAt: "asc" } : { salesStageAt: "desc" },
  })
  return NextResponse.json(wards)
}
