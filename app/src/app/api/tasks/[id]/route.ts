import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { requirePermission } from "@/lib/api-permissions"
import { seesAllTasks } from "@/lib/tasks/task-visibility"
import type { Role } from "@prisma/client"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const existing = await db.task.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!existing) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 })

  // Педагог/«только чтение» могут работать только со СВОИМИ задачами (и только
  // менять статус — см. ниже). Управленцы — с любыми.
  const canManageAll = seesAllTasks(session.user.role as Role)
  if (!canManageAll && existing.assignedTo !== session.user.employeeId) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const updateData: any = {}
  if (body.status === "completed") {
    updateData.status = "completed"
    updateData.completedAt = new Date()
    updateData.completedBy = session.user.employeeId
  } else if (body.status === "cancelled") {
    updateData.status = "cancelled"
  } else if (body.status === "pending") {
    updateData.status = "pending"
    updateData.completedAt = null
    updateData.completedBy = null
  }

  // Редактирование содержания задачи (заголовок/срок/исполнитель) — только у
  // управленцев; педагог меняет лишь статус своей задачи.
  if (canManageAll) {
    if (body.title) updateData.title = body.title
    if (body.dueDate) updateData.dueDate = new Date(body.dueDate)
    if (body.assignedTo) updateData.assignedTo = body.assignedTo
  }

  const task = await db.task.update({
    where: { id },
    data: updateData,
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true } },
      client: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  return NextResponse.json(task)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Удаление задач — управленческое действие (владелец/управляющий/администратор).
  const guard = await requirePermission("clients.edit")
  if (!guard.ok) return guard.response
  const session = guard.session! as { user: { tenantId: string } }

  const { id } = await params

  const existing = await db.task.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!existing) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 })

  await db.task.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  return NextResponse.json({ success: true })
}
