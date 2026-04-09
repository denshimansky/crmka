import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { recalcLinkedDiscounts } from "@/lib/linked-discount"

// PATCH /api/enrollments/[id] — деактивировать зачисление (отчислить ученика из группы)
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const tenantId = (session.user as any).tenantId

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const result = await db.$transaction(async (tx) => {
    const enrollment = await tx.groupEnrollment.findFirst({
      where: { id, tenantId, isActive: true, deletedAt: null },
    })

    if (!enrollment) return null

    const updated = await tx.groupEnrollment.update({
      where: { id },
      data: {
        isActive: false,
        withdrawnAt: today,
      },
      include: {
        client: {
          select: { id: true, firstName: true, lastName: true, phone: true },
        },
        ward: {
          select: { id: true, firstName: true, lastName: true, birthDate: true },
        },
      },
    })

    // SUB-07: пересчитать связанные скидки при деактивации зачисления
    const linkedDiscountChanges = await recalcLinkedDiscounts(
      tx,
      tenantId,
      enrollment.clientId
    )

    return { enrollment: updated, linkedDiscountChanges }
  })

  if (!result) {
    return NextResponse.json(
      { error: "Зачисление не найдено или уже неактивно" },
      { status: 404 }
    )
  }

  const response: any = { ...result.enrollment }
  if (result.linkedDiscountChanges.length > 0) {
    response._linkedDiscountWarning = {
      message: `Связанная скидка снята с ${result.linkedDiscountChanges.length} абонемент(ов), т.к. активных абонементов стало меньше 2`,
      affected: result.linkedDiscountChanges,
    }
  }

  return NextResponse.json(response)
}
