import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

// GET /api/attendance-types — системные (tenantId=null) + кастомные текущего тенанта
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = (session.user as any).tenantId

  const types = await db.attendanceType.findMany({
    where: {
      OR: [{ tenantId: null }, { tenantId }],
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })

  return NextResponse.json(types)
}

const createSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(100),
  code: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/, "Только латиница, цифры и _"),
  chargesSubscription: z.boolean().default(false),
  paysInstructor: z.boolean().default(false),
  countsAsRevenue: z.boolean().default(false),
  availableToInstructor: z.boolean().default(false),
  partOfPlan: z.boolean().default(false),
  partOfFact: z.boolean().default(false),
  partOfForecast: z.boolean().default(false),
  chargePercent: z.number().int().min(0).max(100).default(100),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(100),
})

// POST /api/attendance-types — создать кастомный тип посещения
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const tenantId = (session.user as any).tenantId
  const body = await request.json()
  const parsed = createSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  // Зарезервированные коды нельзя занимать пользовательскими типами.
  const RESERVED_CODES = ["present", "no_show", "excused", "absent", "recalculation", "makeup", "makeup_scheduled"]
  if (RESERVED_CODES.includes(parsed.data.code)) {
    return NextResponse.json(
      { error: `Код "${parsed.data.code}" зарезервирован системой` },
      { status: 409 }
    )
  }

  const codeConflict = await db.attendanceType.findFirst({
    where: {
      code: parsed.data.code,
      OR: [{ tenantId: null }, { tenantId }],
    },
  })
  if (codeConflict) {
    return NextResponse.json(
      { error: `Код "${parsed.data.code}" уже используется` },
      { status: 409 }
    )
  }

  const created = await db.attendanceType.create({
    data: {
      tenantId,
      code: parsed.data.code,
      name: parsed.data.name,
      chargesSubscription: parsed.data.chargesSubscription,
      paysInstructor: parsed.data.paysInstructor,
      countsAsRevenue: parsed.data.countsAsRevenue,
      availableToInstructor: parsed.data.availableToInstructor,
      partOfPlan: parsed.data.partOfPlan,
      partOfFact: parsed.data.partOfFact,
      partOfForecast: parsed.data.partOfForecast,
      chargePercent: parsed.data.chargePercent,
      isSystem: false,
      isActive: parsed.data.isActive,
      sortOrder: parsed.data.sortOrder,
    },
  })

  return NextResponse.json(created, { status: 201 })
}
