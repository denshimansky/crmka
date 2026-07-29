import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { z } from "zod"
import { Prisma, type Role } from "@prisma/client"
import { requirePermission } from "@/lib/api-permissions"
import { taskVisibilityWhere } from "@/lib/tasks/task-visibility"
import { branchScopeFromSession } from "@/lib/branch-scope"

const createSchema = z.object({
  title: z.string().min(1, "Введите заголовок"),
  description: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  assignedTo: z.string().uuid("Выберите исполнителя"),
  dueDate: z.string().min(1, "Укажите дату"),
  clientId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function GET(req: NextRequest) {
  const guard = await requirePermission("tasks.view")
  if (!guard.ok) return guard.response
  const user = guard.session!.user as {
    role: Role; tenantId: string; employeeId: string | null
    allowedBranchIds: string[] | null
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") || "pending"

  const where: Prisma.TaskWhereInput = {
    tenantId: user.tenantId,
    deletedAt: null,
    status: status as any,
    // Инструктор/«только чтение» — только свои задачи; админ с привязкой к
    // филиалу — только задачи своих филиалов (ADM-04). См. lib/tasks/task-visibility.ts.
    ...taskVisibilityWhere(user.role, user.employeeId, branchScopeFromSession(user.allowedBranchIds)),
  }

  const tasks = await db.task.findMany({
    where,
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true } },
      client: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { dueDate: "asc" },
    take: 200,
  })

  return NextResponse.json(tasks)
}

export async function POST(req: NextRequest) {
  // Создавать задачи вручную может только тот, кто редактирует клиентов
  // (владелец/управляющий/администратор). Инструктор/«только чтение» — нет.
  const guard = await requirePermission("clients.edit")
  if (!guard.ok) return guard.response
  const user = guard.session!.user as {
    role: string; tenantId: string; employeeId: string | null
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const task = await db.task.create({
    data: {
      tenantId: user.tenantId,
      title: data.title,
      description: data.description,
      type: "manual",
      status: "pending",
      dueDate: new Date(data.dueDate),
      assignedTo: data.assignedTo,
      assignedBy: user.employeeId,
      clientId: data.clientId,
    },
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true } },
      client: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  return NextResponse.json(task, { status: 201 })
}
