import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createSchema = z.object({
  name: z.string().min(1, "Название обязательно"),
  type: z.enum(["cash", "bank_account", "acquiring", "online"], {
    errorMap: () => ({ message: "Выберите тип счёта" }),
  }),
  branchId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const accounts = await db.financialAccount.findMany({
    where: {
      tenantId: session.user.tenantId,
      deletedAt: null,
    },
    include: {
      branch: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(accounts)
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

  const account = await db.financialAccount.create({
    data: {
      tenantId: session.user.tenantId,
      name: data.name,
      type: data.type,
      branchId: data.branchId,
    },
    include: {
      branch: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json(account, { status: 201 })
}
