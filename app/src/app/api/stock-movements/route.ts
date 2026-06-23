import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { z } from "zod"

// ── Общие хелперы складских движений (используются transfer/transfer_to_room/write_off).
// На складских таблицах нет RLS (см. примечание в POST) — поэтому принадлежность
// тенанту каждого id проверяем в приложении, прежде чем читать/менять остаток.
type Tx = Prisma.TransactionClient
const round2 = (n: number) => Math.round(n * 100) / 100

async function assertItem(tx: Tx, tenantId: string, stockItemId: string) {
  const item = await tx.stockItem.findFirst({ where: { id: stockItemId, tenantId, deletedAt: null }, select: { id: true } })
  if (!item) throw new Error("ITEM")
}

async function assertLocation(tx: Tx, tenantId: string, loc: { kind: "warehouse" | "room"; id: string }) {
  const found = loc.kind === "warehouse"
    ? await tx.branch.findFirst({ where: { id: loc.id, tenantId, deletedAt: null }, select: { id: true } })
    : await tx.room.findFirst({ where: { id: loc.id, tenantId, deletedAt: null }, select: { id: true } })
  if (!found) throw new Error("LOCATION")
}

// Атомарное списание остатка: условный updateMany (quantity >= нужного) не даёт
// двум параллельным операциям увести остаток в минус (check-then-decrement race).
// Если уходит весь остаток — переносим всю себестоимость (иначе на нулевом
// количестве зависал бы дробный totalCost). Возвращает перенесённую себестоимость.
async function debitWarehouse(tx: Tx, stockItemId: string, branchId: string, quantity: number) {
  const bal = await tx.stockBalance.findUnique({ where: { stockItemId_branchId: { stockItemId, branchId } } })
  if (!bal || Number(bal.quantity) < quantity) throw new Error("INSUFFICIENT")
  const q = Number(bal.quantity)
  const unitCost = q > 0 ? Number(bal.totalCost) / q : 0
  const totalCost = Math.abs(q - quantity) < 1e-9 ? Number(bal.totalCost) : round2(unitCost * quantity)
  const dec = await tx.stockBalance.updateMany({
    where: { id: bal.id, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity }, totalCost: { decrement: totalCost } },
  })
  if (dec.count === 0) throw new Error("INSUFFICIENT")
  return { unitCost, totalCost }
}

async function debitRoom(tx: Tx, stockItemId: string, roomId: string, quantity: number) {
  const bal = await tx.roomBalance.findUnique({ where: { roomId_stockItemId: { roomId, stockItemId } } })
  if (!bal || Number(bal.quantity) < quantity) throw new Error("INSUFFICIENT")
  const q = Number(bal.quantity)
  const unitCost = q > 0 ? Number(bal.totalCost) / q : 0
  const totalCost = Math.abs(q - quantity) < 1e-9 ? Number(bal.totalCost) : round2(unitCost * quantity)
  const dec = await tx.roomBalance.updateMany({
    where: { id: bal.id, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity }, totalCost: { decrement: totalCost } },
  })
  if (dec.count === 0) throw new Error("INSUFFICIENT")
  return { unitCost, totalCost }
}

async function creditWarehouse(tx: Tx, tenantId: string, stockItemId: string, branchId: string, quantity: number, totalCost: number) {
  const ex = await tx.stockBalance.findUnique({ where: { stockItemId_branchId: { stockItemId, branchId } } })
  if (ex) await tx.stockBalance.update({ where: { id: ex.id }, data: { quantity: { increment: quantity }, totalCost: { increment: totalCost } } })
  else await tx.stockBalance.create({ data: { tenantId, stockItemId, branchId, quantity, totalCost } })
}

async function creditRoom(tx: Tx, tenantId: string, stockItemId: string, roomId: string, quantity: number, totalCost: number) {
  const ex = await tx.roomBalance.findUnique({ where: { roomId_stockItemId: { roomId, stockItemId } } })
  if (ex) await tx.roomBalance.update({ where: { id: ex.id }, data: { quantity: { increment: quantity }, totalCost: { increment: totalCost } } })
  else await tx.roomBalance.create({ data: { tenantId, roomId, stockItemId, quantity, totalCost } })
}

// Перевод доменных ошибок транзакции в HTTP-ответ. null — ошибка не доменная (пробросить).
function stockTxError(e: unknown): NextResponse | null {
  const msg = e instanceof Error ? e.message : ""
  if (msg === "INSUFFICIENT") return NextResponse.json({ error: "Недостаточно товара в источнике" }, { status: 400 })
  if (msg === "ITEM") return NextResponse.json({ error: "Товар не найден" }, { status: 404 })
  if (msg === "LOCATION") return NextResponse.json({ error: "Локация не найдена" }, { status: 404 })
  return null
}

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

// INV-02 (расширенный): перемещение в любом направлении. Локация — склад филиала
// (warehouse) или кабинет (room). Источник и приёмник не должны совпадать.
const locationSchema = z.object({
  kind: z.enum(["warehouse", "room"]),
  id: z.string().uuid(),
})
const transferAnySchema = z
  .object({
    type: z.literal("transfer"),
    stockItemId: z.string().uuid(),
    from: locationSchema,
    to: locationSchema,
    quantity: z.number().positive(),
    comment: z.string().optional(),
  })
  .refine((d) => !(d.from.kind === d.to.kind && d.from.id === d.to.id), {
    message: "Источник и приёмник совпадают",
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

  const tenantId = session.user.tenantId
  const { searchParams } = new URL(req.url)
  const branchId = searchParams.get("branchId")

  const where: any = { tenantId }
  if (branchId) where.fromBranchId = branchId

  const [movements, branches, rooms] = await Promise.all([
    db.stockMovement.findMany({
      where,
      include: {
        stockItem: { select: { name: true, unit: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { date: "desc" },
      take: 200,
    }),
    // Имена локаций для колонки «Откуда → Куда». Удалённые тоже берём (на движение
    // могла ссылаться уже удалённая комната/филиал) — поэтому без фильтра deletedAt.
    db.branch.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    db.room.findMany({ where: { tenantId }, select: { id: true, name: true, branch: { select: { name: true } } } }),
  ])

  const branchMap = new Map(branches.map((b) => [b.id, b.name]))
  // Кабинет показываем с филиалом — как в модалке, иначе «каб. 1 → каб. 1» неоднозначно.
  const roomMap = new Map(rooms.map((r) => [r.id, `${r.branch.name} · каб. ${r.name}`]))
  const branchLabel = (id: string | null) => (id ? `Склад · ${branchMap.get(id) ?? "—"}` : null)
  const roomLabel = (id: string | null) => (id ? (roomMap.get(id) ?? "Кабинет · —") : null)

  const enriched = movements.map((m) => ({
    ...m,
    fromLabel: branchLabel(m.fromBranchId) ?? roomLabel(m.fromRoomId),
    toLabel: roomLabel(m.toRoomId) ?? branchLabel(m.toBranchId),
  }))

  return NextResponse.json(enriched)
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

  // INV-02 (legacy): Перемещение склад → кабинет. Новый UI шлёт type:"transfer";
  // оставлено для совместимости API. Те же проверки тенанта и атомарность.
  if (body.type === "transfer_to_room") {
    const parsed = transferSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
    const d = parsed.data

    try {
      await db.$transaction(async (tx) => {
        await assertItem(tx, tenantId, d.stockItemId)
        await assertLocation(tx, tenantId, { kind: "warehouse", id: d.fromBranchId })
        await assertLocation(tx, tenantId, { kind: "room", id: d.toRoomId })

        const { unitCost, totalCost } = await debitWarehouse(tx, d.stockItemId, d.fromBranchId, d.quantity)
        await creditRoom(tx, tenantId, d.stockItemId, d.toRoomId, d.quantity, totalCost)

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
    } catch (e) {
      const resp = stockTxError(e)
      if (resp) return resp
      throw e
    }

    return NextResponse.json({ success: true }, { status: 201 })
  }

  // INV-02 (расширенный): перемещение в любом направлении (склад↔кабинет,
  // склад↔склад, кабинет↔кабинет). Деньги не двигаются — только остатки.
  // Себестоимость переносится по средней (как в transfer_to_room/write_off).
  if (body.type === "transfer") {
    const parsed = transferAnySchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
    const d = parsed.data

    try {
      await db.$transaction(async (tx) => {
        // Товар, источник и приёмник должны принадлежать тенанту (защита от чужих id).
        await assertItem(tx, tenantId, d.stockItemId)
        await assertLocation(tx, tenantId, d.from)
        await assertLocation(tx, tenantId, d.to)

        // 1. Списываем с источника (атомарно, по средней себестоимости).
        const { unitCost, totalCost } = d.from.kind === "warehouse"
          ? await debitWarehouse(tx, d.stockItemId, d.from.id, d.quantity)
          : await debitRoom(tx, d.stockItemId, d.from.id, d.quantity)

        // 2. Зачисляем приёмнику (создаём остаток, если его ещё нет).
        if (d.to.kind === "warehouse") await creditWarehouse(tx, tenantId, d.stockItemId, d.to.id, d.quantity, totalCost)
        else await creditRoom(tx, tenantId, d.stockItemId, d.to.id, d.quantity, totalCost)

        // 3. Запись в журнал движений.
        await tx.stockMovement.create({
          data: {
            tenantId,
            stockItemId: d.stockItemId,
            type: "transfer",
            quantity: d.quantity,
            unitCost,
            totalCost,
            fromBranchId: d.from.kind === "warehouse" ? d.from.id : null,
            fromRoomId: d.from.kind === "room" ? d.from.id : null,
            toBranchId: d.to.kind === "warehouse" ? d.to.id : null,
            toRoomId: d.to.kind === "room" ? d.to.id : null,
            date: new Date(),
            comment: d.comment,
            createdById: session.user.employeeId,
          },
        })
      })
    } catch (e) {
      const resp = stockTxError(e)
      if (resp) return resp
      throw e
    }

    return NextResponse.json({ success: true }, { status: 201 })
  }

  // INV-03: Списание из кабинета
  if (body.type === "write_off") {
    const parsed = writeOffSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
    const d = parsed.data

    try {
      await db.$transaction(async (tx) => {
        await assertItem(tx, tenantId, d.stockItemId)
        await assertLocation(tx, tenantId, { kind: "room", id: d.roomId })

        const { unitCost, totalCost } = await debitRoom(tx, d.stockItemId, d.roomId, d.quantity)

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
    } catch (e) {
      const resp = stockTxError(e)
      if (resp) return resp
      throw e
    }

    return NextResponse.json({ success: true }, { status: 201 })
  }

  return NextResponse.json({ error: "Неизвестный тип операции" }, { status: 400 })
}
