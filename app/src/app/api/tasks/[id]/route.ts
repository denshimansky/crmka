import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const existing = await db.task.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!existing) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 })

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

  if (body.title) updateData.title = body.title
  if (body.dueDate) updateData.dueDate = new Date(body.dueDate)
  if (body.assignedTo) updateData.assignedTo = body.assignedTo

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
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  await db.task.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  return NextResponse.json({ success: true })
}
