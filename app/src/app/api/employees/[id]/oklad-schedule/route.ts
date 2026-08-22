import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { logAudit } from "@/lib/audit"
import { getOkladCategoryId } from "@/lib/salary/oklad-category"
import { resyncOkladTwinsFromMonth } from "@/lib/salary/sync-oklad-twin"

// История оклада: версия = «с этой даты оклад стал таким».
//
// В отличие от версий сдельной ставки, дата НЕ обязана быть в будущем: смысл истории
// в том, чтобы зафиксировать уже случившееся изменение (например «сняли с оклада с 1
// августа») и при этом НЕ переписать прошлые месяцы. Правка Employee.monthlySalary
// пересчитывает все месяцы новой суммой — именно так у Андреевой (ДЦ Умный Я) июнь и
// июль обнулились, а выплаты и списания за них остались.
const createSchema = z.object({
  effectiveFrom: z
    .string()
    .refine((s) => !Number.isNaN(new Date(s).getTime()), { message: "Некорректная дата" }),
  amount: z.number().min(0, "Оклад не может быть отрицательным"),
  comment: z.any().transform((v) => (typeof v === "string" && v.trim() ? v.trim() : null)),
})

function gate(session: any) {
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return { error: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) }
  }
  return { role }
}

/** Дата как полночь UTC — колонка @db.Date, время не хранится. */
function utcDate(s: string): Date {
  const d = new Date(s)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  const rows = await db.okladSchedule.findMany({
    where: { tenantId: session.user.tenantId, employeeId: id, deletedAt: null },
    select: { id: true, effectiveFrom: true, amount: true, comment: true },
    orderBy: { effectiveFrom: "asc" },
  })
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
      amount: Number(r.amount),
      comment: r.comment,
    })),
  )
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  const g = gate(session)
  if (g.error) return g.error
  const { id } = await params
  const tenantId = session!.user.tenantId
  const actor = session!.user.employeeId ?? null

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data
  const effectiveFrom = utcDate(data.effectiveFrom)

  const employee = await db.employee.findFirst({ where: { id, tenantId }, select: { id: true } })
  if (!employee) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })

  // Одна дата — одна версия: интервалы не пересекаются по построению.
  const duplicate = await db.okladSchedule.findFirst({
    where: { tenantId, employeeId: id, effectiveFrom, deletedAt: null },
    select: { id: true },
  })
  if (duplicate) {
    return NextResponse.json({ error: "Изменение оклада на эту дату уже задано" }, { status: 409 })
  }

  const okladCategoryId = await getOkladCategoryId()
  const created = await db.$transaction(async (tx) => {
    const row = await tx.okladSchedule.create({
      data: {
        tenantId,
        employeeId: id,
        effectiveFrom,
        amount: data.amount,
        comment: data.comment,
        createdBy: actor,
      },
      select: { id: true },
    })
    // Признание оклада в ОПИУ капается окладом периода — пересобираем твины всех
    // проведённых месяцев начиная с даты версии.
    await resyncOkladTwinsFromMonth(tx, {
      tenantId,
      employeeId: id,
      fromYear: effectiveFrom.getUTCFullYear(),
      fromMonth: effectiveFrom.getUTCMonth() + 1,
      okladCategoryId,
      createdBy: actor,
    })
    return row
  })

  logAudit({
    tenantId,
    employeeId: actor,
    action: "create",
    entityType: "OkladSchedule",
    entityId: created.id,
    changes: {
      amount: { new: data.amount },
      effectiveFrom: { new: data.effectiveFrom },
      employeeId: { new: id },
    },
    req,
  })
  return NextResponse.json({ id: created.id }, { status: 201 })
}
