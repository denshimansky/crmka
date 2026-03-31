import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  name: z.string().min(1, "Название обязательно").optional(),
  type: z
    .enum(["cash", "bank_account", "acquiring", "online"], {
      errorMap: () => ({ message: "Некорректный тип счёта" }),
    })
    .optional(),
  branchId: z
    .any()
    .transform((v) =>
      typeof v === "string" && v.trim() ? v.trim() : null
    ),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 }
    )
  }
  const data = parsed.data

  const existing = await db.financialAccount.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!existing)
    return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })

  const account = await db.financialAccount.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.type !== undefined && { type: data.type }),
      ...(data.branchId !== undefined && { branchId: data.branchId }),
    },
    include: {
      branch: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json(account)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json(
      { error: "Недостаточно прав" },
      { status: 403 }
    )
  }

  const { id } = await params

  const existing = await db.financialAccount.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!existing)
    return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })

  await db.financialAccount.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
