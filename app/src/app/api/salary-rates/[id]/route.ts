import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { baseRateSchema, validateForScheme } from "@/app/api/employees/[id]/salary-rates/route"

// PATCH /api/salary-rates/[id] — обновить ставку (включая полное переписывание матрицы)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = session.user.tenantId

  const existing = await db.salaryRate.findFirst({ where: { id, tenantId } })
  if (!existing) return NextResponse.json({ error: "Ставка не найдена" }, { status: 404 })

  const body = await req.json()
  const parsed = baseRateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const validationError = validateForScheme(parsed.data)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const updated = await db.$transaction(async (tx) => {
    await tx.salaryRate.update({
      where: { id },
      data: {
        scheme: parsed.data.scheme,
        ratePerStudent: parsed.data.ratePerStudent ?? null,
        ratePerLesson: parsed.data.ratePerLesson ?? null,
        fixedPerShift: parsed.data.fixedPerShift ?? null,
        percentOfPayments: parsed.data.percentOfPayments ?? null,
      },
    })
    // Полное переписывание матрицы: удаляем все старые брекеты и создаём новые,
    // если они переданы. Это проще, чем сравнивать построчно.
    if (parsed.data.brackets !== undefined) {
      await tx.salaryBracket.deleteMany({ where: { salaryRateId: id } })
      if (parsed.data.brackets.length > 0) {
        await tx.salaryBracket.createMany({
          data: parsed.data.brackets.map((b) => ({
            tenantId,
            salaryRateId: id,
            minStudents: b.minStudents,
            ratePerLesson: b.ratePerLesson,
          })),
        })
      }
    }
    return tx.salaryRate.findUnique({
      where: { id },
      include: {
        direction: { select: { id: true, name: true } },
        brackets: { orderBy: { minStudents: "asc" } },
      },
    })
  })

  return NextResponse.json(updated)
}

// DELETE /api/salary-rates/[id] — удалить ставку
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = session.user.tenantId

  const existing = await db.salaryRate.findFirst({ where: { id, tenantId } })
  if (!existing) return NextResponse.json({ error: "Ставка не найдена" }, { status: 404 })

  await db.salaryRate.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
