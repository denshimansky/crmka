import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

const TAB_VALUES = ["application", "trial", "trial_done", "awaiting_payment"] as const
type SalesTab = (typeof TAB_VALUES)[number]

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
    const rows = await db.application.findMany({
      where: {
        tenantId,
        status: "active",
        deletedAt: null,
        ...(branchId ? { branchId } : {}),
      },
      include: {
        client: { select: clientInclude },
        ward: { select: { id: true, firstName: true, lastName: true } },
        branch: { select: { id: true, name: true } },
        direction: { select: { id: true, name: true, color: true } },
      },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json(rows)
  }

  if (tab === "trial") {
    const rows = await db.trialLesson.findMany({
      where: {
        tenantId,
        status: "scheduled",
        ...(branchId ? { OR: [{ group: { branchId } }, { room: { branchId } }] } : {}),
      },
      include: {
        client: { select: clientInclude },
        ward: { select: { id: true, firstName: true, lastName: true } },
        group: {
          select: {
            id: true,
            name: true,
            branch: { select: { id: true, name: true } },
            direction: { select: { id: true, name: true, color: true } },
          },
        },
        direction: { select: { id: true, name: true, color: true } },
        room: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
        instructor: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { scheduledDate: "asc" },
    })
    return NextResponse.json(rows)
  }

  if (tab === "trial_done") {
    const rows = await db.trialLesson.findMany({
      where: {
        tenantId,
        status: "attended",
        client: {
          funnelStatus: "trial_attended",
          deletedAt: null,
          ...(branchId ? { branchId } : {}),
        },
      },
      include: {
        client: { select: clientInclude },
        ward: { select: { id: true, firstName: true, lastName: true } },
        group: {
          select: {
            id: true,
            name: true,
            branch: { select: { id: true, name: true } },
            direction: { select: { id: true, name: true, color: true } },
          },
        },
        direction: { select: { id: true, name: true, color: true } },
        instructor: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { scheduledDate: "desc" },
    })
    return NextResponse.json(rows)
  }

  // awaiting_payment
  const clients = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      funnelStatus: "awaiting_payment",
      ...(branchId ? { branchId } : {}),
    },
    select: {
      ...clientInclude,
      branch: { select: { id: true, name: true } },
      wards: { select: { id: true, firstName: true, lastName: true } },
      trialLessons: {
        where: { status: "attended" },
        orderBy: { attendedAt: "desc" },
        take: 1,
        select: {
          id: true,
          scheduledDate: true,
          attendedAt: true,
          wardId: true,
          group: {
            select: {
              id: true,
              name: true,
              branch: { select: { id: true, name: true } },
              direction: { select: { id: true, name: true, color: true, lessonPrice: true } },
            },
          },
          direction: { select: { id: true, name: true, color: true, lessonPrice: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  })
  return NextResponse.json(clients)
}
