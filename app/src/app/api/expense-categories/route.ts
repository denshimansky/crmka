import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

// GET /api/expense-categories — системные (tenantId = null) + кастомные категории тенанта.
// По умолчанию возвращаем только активные (для форм создания расхода). Странице
// настроек /settings/finance-categories нужны все — она вызывает с ?includeInactive=true,
// чтобы пользователь мог снова включить категорию, которую раньше деактивировал.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = (session.user as any).tenantId
  const { searchParams } = new URL(request.url)
  const includeInactive = searchParams.get("includeInactive") === "true"

  const categories = await db.expenseCategory.findMany({
    where: {
      OR: [{ tenantId: null }, { tenantId }],
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })

  return NextResponse.json(categories)
}

const createSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(100),
  isVariable: z.boolean().default(false),
  isSalary: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
})

// POST /api/expense-categories — создать пользовательскую категорию (isSystem=false).
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

  const category = await db.expenseCategory.create({
    data: {
      tenantId,
      name: parsed.data.name,
      isVariable: parsed.data.isVariable,
      isSalary: parsed.data.isSalary,
      isActive: parsed.data.isActive,
      sortOrder: parsed.data.sortOrder,
      isSystem: false,
    },
  })

  return NextResponse.json(category, { status: 201 })
}
