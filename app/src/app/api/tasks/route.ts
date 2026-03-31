import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { Prisma } from "@prisma/client"

const createSchema = z.object({
  title: z.string().min(1, "Введите заголовок"),
  description: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  assignedTo: z.string().uuid("Выберите исполнителя"),
  dueDate: z.string().min(1, "Укажите дату"),
  clientId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") || "pending"

  const where: Prisma.TaskWhereInput = {
    tenantId: session.user.tenantId,
    deletedAt: null,
    status: status as any,
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
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const task = await db.task.create({
    data: {
      tenantId: session.user.tenantId,
      title: data.title,
      description: data.description,
      type: "manual",
      status: "pending",
      dueDate: new Date(data.dueDate),
      assignedTo: data.assignedTo,
      assignedBy: session.user.employeeId,
      clientId: data.clientId,
    },
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true } },
      client: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  return NextResponse.json(task, { status: 201 })
}
