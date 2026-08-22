import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import {
  reconcileDayToNonWorking,
  reconcileDayToWorking,
  findNonWorkingBlockers,
  nonWorkingBlockReason,
} from "@/lib/schedule/reconcile-calendar-day"

const createSchema = z.object({
  date: z.string().min(1, "Укажите дату"),
  isWorking: z.boolean(),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const year = searchParams.get("year")
  const month = searchParams.get("month")

  const where: any = {
    tenantId: session.user.tenantId,
  }

  if (year) {
    const y = parseInt(year, 10)
    const m = month ? parseInt(month, 10) : null
    const startDate = m ? new Date(y, m - 1, 1) : new Date(y, 0, 1)
    const endDate = m ? new Date(y, m, 1) : new Date(y + 1, 0, 1)
    where.date = { gte: startDate, lt: endDate }
  }

  const items = await db.productionCalendar.findMany({
    where,
    orderBy: { date: "asc" },
  })

  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data
  const dayDate = new Date(data.date)
  const tenantId = session.user.tenantId
  const createdBy = session.user.employeeId ?? null

  // Прежнее состояние дня по «рабочести»: нет записи или isWorking=true → рабочий;
  // isWorking=false → нерабочий. Нужно, чтобы поймать смену состояния и
  // реконсилить расписание/абонементы (правило заказчика).
  const prior = await db.productionCalendar.findUnique({
    where: { tenantId_date: { tenantId, date: dayDate } },
    select: { isWorking: true },
  })
  const wasNonWorking = prior?.isWorking === false
  const nowNonWorking = data.isWorking === false

  // Пометка «нерабочий» запрещена, пока в дне есть отметки/активные пробные:
  // иначе день применился бы наполовину (см. findNonWorkingBlockers). Проверяем
  // ДО апсёрта, чтобы при отказе запись календаря не осталась.
  if (!wasNonWorking && nowNonWorking) {
    const blockers = await findNonWorkingBlockers(db, { tenantId, date: dayDate })
    const reason = nonWorkingBlockReason(blockers)
    if (reason) {
      return NextResponse.json({ error: reason, lessons: blockers.details }, { status: 409 })
    }
  }

  const item = await db.productionCalendar.upsert({
    where: {
      tenantId_date: {
        tenantId,
        date: dayDate,
      },
    },
    update: {
      isWorking: data.isWorking,
      comment: data.comment,
    },
    create: {
      tenantId,
      date: dayDate,
      isWorking: data.isWorking,
      comment: data.comment,
    },
  })

  // Реконсиляция ПОСЛЕ апсёрта (генератор рабочего дня должен видеть новое
  // состояние календаря). Только при реальной смене «рабочести» — правка одного
  // комментария ничего не пересчитывает.
  let reconcile:
    | { deleted: number; subscriptionsUpdated: number }
    | { created: number; subscriptionsUpdated: number }
    | undefined
  if (!wasNonWorking && nowNonWorking) {
    reconcile = await reconcileDayToNonWorking(db, { tenantId, date: dayDate, createdBy })
  } else if (wasNonWorking && !nowNonWorking) {
    reconcile = await reconcileDayToWorking(db, { tenantId, date: dayDate, createdBy })
  }

  return NextResponse.json({ ...item, reconcile }, { status: 201 })
}
