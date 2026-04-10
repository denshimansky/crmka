import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { Decimal } from "@prisma/client/runtime/library"

const purchaseSchema = z.object({
  type: z.literal("purchase"),
  stockItemId: z.string().uuid(),
  branchId: z.string().uuid(),
  quantity: z.number().positive(),
  unitCost: z.number().min(0),
  amortizationMonths: z.number().int().min(1).optional(),
  comment: z.string().optional(),
})

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

  // INV-01: Закупка
  if (body.type === "purchase") {
    const parsed = purchaseSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
    const d = parsed.data
    const totalCost = d.quantity * d.unitCost

    await db.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          tenantId,
          stockItemId: d.stockItemId,
          type: "purchase",
          quantity: d.quantity,
          unitCost: d.unitCost,
          totalCost,
          fromBranchId: d.branchId,
          amortizationMonths: d.amortizationMonths,
          date: new Date(),
          comment: d.comment,
          createdById: session.user.employeeId,
        },
      })

      // Обновляем или создаём баланс на складе филиала
      const existing = await tx.stockBalance.findUnique({
        where: { stockItemId_branchId: { stockItemId: d.stockItemId, branchId: d.branchId } },
      })

      if (existing) {
        await tx.stockBalance.update({
          where: { id: existing.id },
          data: {
            quantity: { increment: d.quantity },
            totalCost: { increment: totalCost },
          },
        })
      } else {
        await tx.stockBalance.create({
          data: {
            tenantId,
            stockItemId: d.stockItemId,
            branchId: d.branchId,
            quantity: d.quantity,
            totalCost,
          },
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
