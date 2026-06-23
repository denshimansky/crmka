import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

// Категория расхода, на которую относится закупка товара на склад (INV-01).
// Системная (tenantId=null), переменная. Если её нет — создаём тенантную.
const STOCK_EXPENSE_CATEGORY = "Канцтовары и расходники"

const purchaseSchema = z
  .object({
    type: z.literal("purchase"),
    // Товар: либо по id (существующий), либо по имени (создаётся, если нового нет).
    stockItemId: z.string().uuid().optional(),
    itemName: z.string().trim().min(1).optional(),
    unit: z.string().trim().min(1).optional(),
    branchId: z.string().uuid(),
    // Счёт оплаты — закупка проводится расходом в ДДС/ОПИУ, деньги уходят со счёта.
    accountId: z.string().uuid("Выберите счёт оплаты"),
    // Статья расхода (категория). Если не указана — «Канцтовары и расходники».
    categoryId: z.string().uuid().optional(),
    quantity: z.number().positive(),
    unitCost: z.number().min(0),
    amortizationMonths: z.number().int().min(1).optional(),
    comment: z.string().optional(),
  })
  .refine((d) => d.stockItemId || d.itemName, { message: "Укажите наименование товара" })

const transferSchema = z.object({
  type: z.literal("transfer_to_room"),
  stockItemId: z.string().uuid(),
  fromBranchId: z.string().uuid(),
  toRoomId: z.string().uuid(),
  quantity: z.number().positive(),
  comment: z.string().optional(),
})

const writeOffSchema = z.object({
  type: z.literal("write_off"),
  stockItemId: z.string().uuid(),
  roomId: z.string().uuid(),
  quantity: z.number().positive(),
  comment: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const branchId = searchParams.get("branchId")

  const where: any = { tenantId: session.user.tenantId }
  if (branchId) where.fromBranchId = branchId

  const movements = await db.stockMovement.findMany({
    where,
    include: {
      stockItem: { select: { name: true, unit: true } },
      createdBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { date: "desc" },
    take: 200,
  })

  return NextResponse.json(movements)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!["owner", "manager", "admin"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const tenantId = session.user.tenantId

  // INV-01: Закупка на склад. Проводится расходом (категория «Канцтовары и
  // расходники»): полная сумма уходит в ДДС и в ОПИУ/прибыль сразу (по выбору
  // владельца). Перемещение в кабинет денег не двигает — только склад.
  if (body.type === "purchase") {
    const parsed = purchaseSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
    const d = parsed.data
    const totalCost = Math.round(d.quantity * d.unitCost * 100) / 100

    // Счёт и филиал — наши.
    const [account, branch] = await Promise.all([
      db.financialAccount.findFirst({ where: { id: d.accountId, tenantId, deletedAt: null }, select: { id: true } }),
      db.branch.findFirst({ where: { id: d.branchId, tenantId, deletedAt: null }, select: { id: true } }),
    ])
    if (!account) return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })
    if (!branch) return NextResponse.json({ error: "Филиал не найден" }, { status: 404 })

    // Товар: по id или найти существующий по имени (новый создаём в транзакции).
    let resolvedItemId: string | null = null
    if (d.stockItemId) {
      const item = await db.stockItem.findFirst({ where: { id: d.stockItemId, tenantId, deletedAt: null }, select: { id: true } })
      if (!item) return NextResponse.json({ error: "Товар не найден" }, { status: 404 })
      resolvedItemId = item.id
    } else {
      const existing = await db.stockItem.findFirst({ where: { tenantId, deletedAt: null, name: d.itemName! }, select: { id: true } })
      resolvedItemId = existing?.id ?? null
    }

    // Категория расхода: выбранная в форме или дефолтная «Канцтовары и расходники»
    // (если её нет — создаём в транзакции ниже).
    let category: { id: string } | null
    if (d.categoryId) {
      category = await db.expenseCategory.findFirst({
        where: { id: d.categoryId, isActive: true, OR: [{ tenantId }, { tenantId: null }] },
        select: { id: true },
      })
      if (!category) return NextResponse.json({ error: "Статья расхода не найдена" }, { status: 404 })
    } else {
      category = await db.expenseCategory.findFirst({
        where: { name: STOCK_EXPENSE_CATEGORY, isActive: true, OR: [{ tenantId }, { tenantId: null }] },
        orderBy: { tenantId: "desc" },
        select: { id: true },
      })
    }

    const today = new Date()
    const amortized = !!d.amortizationMonths && d.amortizationMonths >= 2
    const startOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))

    await db.$transaction(async (tx) => {
      if (!category) {
        category = await tx.expenseCategory.create({
          data: { tenantId, name: STOCK_EXPENSE_CATEGORY, isVariable: true, isActive: true, sortOrder: 7 },
          select: { id: true },
        })
      }

      // Новый товар — создаём.
      let itemId = resolvedItemId
      if (!itemId) {
        const created = await tx.stockItem.create({
          data: { tenantId, name: d.itemName!, unit: d.unit || "шт", defaultUnitCost: d.unitCost },
        })
        itemId = created.id
      }

      // Расход: ДДС (по дате) + ОПИУ (сразу или амортизация по N мес).
      const expense = await tx.expense.create({
        data: {
          tenantId,
          categoryId: category.id,
          accountId: d.accountId,
          amount: totalCost,
          date: today,
          comment: d.comment ? `Закупка товара: ${d.comment}` : "Закупка товара на склад",
          isVariable: true,
          isRecurring: false,
          recognitionMode: amortized ? "amortized" : "by_payment_date",
          amortizationMonths: amortized ? d.amortizationMonths : null,
          amortizationStartDate: amortized ? startOfMonth : null,
          createdBy: session.user.employeeId,
        },
      })
      // Привязка к филиалу (для scope и ОПИУ); направление не указываем.
      await tx.expenseBranch.create({
        data: { tenantId, expenseId: expense.id, branchId: d.branchId, directionId: null },
      })
      // Списываем со счёта (ДДС).
      await tx.financialAccount.update({
        where: { id: d.accountId },
        data: { balance: { decrement: totalCost } },
      })

      // Движение склада + остаток на складе филиала.
      await tx.stockMovement.create({
        data: {
          tenantId,
          stockItemId: itemId,
          type: "purchase",
          quantity: d.quantity,
          unitCost: d.unitCost,
          totalCost,
          fromBranchId: d.branchId,
          amortizationMonths: d.amortizationMonths,
          expenseId: expense.id,
          date: today,
          comment: d.comment,
          createdById: session.user.employeeId,
        },
      })

      const existing = await tx.stockBalance.findUnique({
        where: { stockItemId_branchId: { stockItemId: itemId, branchId: d.branchId } },
      })
      if (existing) {
        await tx.stockBalance.update({
          where: { id: existing.id },
          data: { quantity: { increment: d.quantity }, totalCost: { increment: totalCost } },
        })
      } else {
        await tx.stockBalance.create({
          data: { tenantId, stockItemId: itemId, branchId: d.branchId, quantity: d.quantity, totalCost },
        })
      }
    })

    return NextResponse.json({ success: true }, { status: 201 })
  }

  // INV-02: Перемещение склад → кабинет
  if (body.type === "transfer_to_room") {
    const parsed = transferSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
    const d = parsed.data

    await db.$transaction(async (tx) => {
      // Проверяем наличие на складе
      const balance = await tx.stockBalance.findUnique({
        where: { stockItemId_branchId: { stockItemId: d.stockItemId, branchId: d.fromBranchId } },
      })
      if (!balance || Number(balance.quantity) < d.quantity) {
        throw new Error("INSUFFICIENT")
      }

      const unitCost = Number(balance.totalCost) / Number(balance.quantity)
      const totalCost = unitCost * d.quantity

      // Списываем со склада
      await tx.stockBalance.update({
        where: { id: balance.id },
        data: {
          quantity: { decrement: d.quantity },
          totalCost: { decrement: totalCost },
        },
      })

      // Добавляем в кабинет
      const roomBal = await tx.roomBalance.findUnique({
        where: { roomId_stockItemId: { roomId: d.toRoomId, stockItemId: d.stockItemId } },
      })
      if (roomBal) {
        await tx.roomBalance.update({
          where: { id: roomBal.id },
          data: {
            quantity: { increment: d.quantity },
            totalCost: { increment: totalCost },
          },
        })
      } else {
        await tx.roomBalance.create({
          data: {
            tenantId,
            roomId: d.toRoomId,
            stockItemId: d.stockItemId,
            quantity: d.quantity,
            totalCost,
          },
        })
      }

      await tx.stockMovement.create({
        data: {
          tenantId,
          stockItemId: d.stockItemId,
          type: "transfer_to_room",
          quantity: d.quantity,
          unitCost,
          totalCost,
          fromBranchId: d.fromBranchId,
          toRoomId: d.toRoomId,
          date: new Date(),
          comment: d.comment,
          createdById: session.user.employeeId,
        },
      })
    })

    return NextResponse.json({ success: true }, { status: 201 })
  }

  // INV-03: Списание из кабинета
  if (body.type === "write_off") {
    const parsed = writeOffSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
    const d = parsed.data

    await db.$transaction(async (tx) => {
      const roomBal = await tx.roomBalance.findUnique({
        where: { roomId_stockItemId: { roomId: d.roomId, stockItemId: d.stockItemId } },
      })
      if (!roomBal || Number(roomBal.quantity) < d.quantity) {
        throw new Error("INSUFFICIENT")
      }

      const unitCost = Number(roomBal.totalCost) / Number(roomBal.quantity)
      const totalCost = unitCost * d.quantity

      await tx.roomBalance.update({
        where: { id: roomBal.id },
        data: {
          quantity: { decrement: d.quantity },
          totalCost: { decrement: totalCost },
        },
      })

      await tx.stockMovement.create({
        data: {
          tenantId,
          stockItemId: d.stockItemId,
          type: "write_off",
          quantity: d.quantity,
          unitCost,
          totalCost,
          toRoomId: d.roomId,
          date: new Date(),
          comment: d.comment,
          createdById: session.user.employeeId,
        },
      })
    })

    return NextResponse.json({ success: true }, { status: 201 })
  }

  return NextResponse.json({ error: "Неизвестный тип операции" }, { status: 400 })
}
