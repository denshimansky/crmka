import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { Prisma } from "@prisma/client"
import { z } from "zod"

// ── Складские движения. Три локации товара: общий склад (warehouse, один на
// организацию, без id), филиал (branch) и кабинет (room). Склад чисто
// информационный — НИ ОДНА операция не двигает деньги (нет расхода в ДДС/ОПИУ).
// На складских таблицах нет RLS — поэтому принадлежность тенанту каждого id
// проверяем в приложении, прежде чем читать/менять остаток.
type Tx = Prisma.TransactionClient
const round2 = (n: number) => Math.round(n * 100) / 100

// Локация товара: общий склад (без id) | филиал | кабинет.
type Loc =
  | { kind: "warehouse" }
  | { kind: "branch"; id: string }
  | { kind: "room"; id: string }

async function assertItem(tx: Tx, tenantId: string, stockItemId: string) {
  const item = await tx.stockItem.findFirst({ where: { id: stockItemId, tenantId, deletedAt: null }, select: { id: true } })
  if (!item) throw new Error("ITEM")
}

async function assertLocation(tx: Tx, tenantId: string, loc: Loc) {
  if (loc.kind === "warehouse") return // общий склад есть всегда (один на тенант)
  const found = loc.kind === "branch"
    ? await tx.branch.findFirst({ where: { id: loc.id, tenantId, deletedAt: null }, select: { id: true } })
    : await tx.room.findFirst({ where: { id: loc.id, tenantId, deletedAt: null }, select: { id: true } })
  if (!found) throw new Error("LOCATION")
}

// Атомарное списание остатка из локации. Условный updateMany (quantity >= нужного)
// не даёт двум параллельным операциям увести остаток в минус. Если уходит весь
// остаток — переносим всю себестоимость (иначе на нулевом количестве зависал бы
// дробный totalCost). Возвращает перенесённую себестоимость.
type BalanceRow = { id: string; quantity: Prisma.Decimal; totalCost: Prisma.Decimal } | null
async function debit(tx: Tx, tenantId: string, stockItemId: string, loc: Loc, quantity: number) {
  if (loc.kind === "warehouse") {
    const bal = await tx.warehouseBalance.findUnique({ where: { tenantId_stockItemId: { tenantId, stockItemId } } })
    return debitRow(bal, quantity, (id, qty, tc) =>
      tx.warehouseBalance.updateMany({ where: { id, quantity: { gte: qty } }, data: { quantity: { decrement: qty }, totalCost: { decrement: tc } } }))
  }
  if (loc.kind === "branch") {
    const bal = await tx.stockBalance.findUnique({ where: { stockItemId_branchId: { stockItemId, branchId: loc.id } } })
    return debitRow(bal, quantity, (id, qty, tc) =>
      tx.stockBalance.updateMany({ where: { id, quantity: { gte: qty } }, data: { quantity: { decrement: qty }, totalCost: { decrement: tc } } }))
  }
  const bal = await tx.roomBalance.findUnique({ where: { roomId_stockItemId: { roomId: loc.id, stockItemId } } })
  return debitRow(bal, quantity, (id, qty, tc) =>
    tx.roomBalance.updateMany({ where: { id, quantity: { gte: qty } }, data: { quantity: { decrement: qty }, totalCost: { decrement: tc } } }))
}

async function debitRow(bal: BalanceRow, quantity: number, decrement: (id: string, qty: number, totalCost: number) => Promise<{ count: number }>) {
  if (!bal || Number(bal.quantity) < quantity) throw new Error("INSUFFICIENT")
  const q = Number(bal.quantity)
  const unitCost = q > 0 ? Number(bal.totalCost) / q : 0
  const totalCost = Math.abs(q - quantity) < 1e-9 ? Number(bal.totalCost) : round2(unitCost * quantity)
  const dec = await decrement(bal.id, quantity, totalCost)
  if (dec.count === 0) throw new Error("INSUFFICIENT")
  return { unitCost, totalCost }
}

// Зачисление остатка в локацию (создаём, если ещё нет).
async function credit(tx: Tx, tenantId: string, stockItemId: string, loc: Loc, quantity: number, totalCost: number) {
  if (loc.kind === "warehouse") {
    const ex = await tx.warehouseBalance.findUnique({ where: { tenantId_stockItemId: { tenantId, stockItemId } } })
    if (ex) await tx.warehouseBalance.update({ where: { id: ex.id }, data: { quantity: { increment: quantity }, totalCost: { increment: totalCost } } })
    else await tx.warehouseBalance.create({ data: { tenantId, stockItemId, quantity, totalCost } })
    return
  }
  if (loc.kind === "branch") {
    const ex = await tx.stockBalance.findUnique({ where: { stockItemId_branchId: { stockItemId, branchId: loc.id } } })
    if (ex) await tx.stockBalance.update({ where: { id: ex.id }, data: { quantity: { increment: quantity }, totalCost: { increment: totalCost } } })
    else await tx.stockBalance.create({ data: { tenantId, stockItemId, branchId: loc.id, quantity, totalCost } })
    return
  }
  const ex = await tx.roomBalance.findUnique({ where: { roomId_stockItemId: { roomId: loc.id, stockItemId } } })
  if (ex) await tx.roomBalance.update({ where: { id: ex.id }, data: { quantity: { increment: quantity }, totalCost: { increment: totalCost } } })
  else await tx.roomBalance.create({ data: { tenantId, roomId: loc.id, stockItemId, quantity, totalCost } })
}

// Колонки источника/приёмника в журнале движений из локации.
function fromColumns(loc: Loc) {
  return {
    fromWarehouse: loc.kind === "warehouse",
    fromBranchId: loc.kind === "branch" ? loc.id : null,
    fromRoomId: loc.kind === "room" ? loc.id : null,
  }
}
function toColumns(loc: Loc) {
  return {
    toWarehouse: loc.kind === "warehouse",
    toBranchId: loc.kind === "branch" ? loc.id : null,
    toRoomId: loc.kind === "room" ? loc.id : null,
  }
}

// Перевод доменных ошибок транзакции в HTTP-ответ. null — ошибка не доменная (пробросить).
function stockTxError(e: unknown): NextResponse | null {
  const msg = e instanceof Error ? e.message : ""
  if (msg === "INSUFFICIENT") return NextResponse.json({ error: "Недостаточно товара в источнике" }, { status: 400 })
  if (msg === "ITEM") return NextResponse.json({ error: "Товар не найден" }, { status: 404 })
  if (msg === "LOCATION") return NextResponse.json({ error: "Локация не найдена" }, { status: 404 })
  return null
}

// INV-01: внесение товара на общий склад. Товар по id (существующий) либо по имени
// (создаём, если нового нет). Денег НЕ двигает — расход не создаётся.
const purchaseSchema = z
  .object({
    type: z.literal("purchase"),
    stockItemId: z.string().uuid().optional(),
    itemName: z.string().trim().min(1).optional(),
    unit: z.string().trim().min(1).optional(),
    quantity: z.number().positive(),
    unitCost: z.number().min(0),
  })
  .refine((d) => d.stockItemId || d.itemName, { message: "Укажите наименование товара" })

const locationSchema = z
  .object({ kind: z.enum(["warehouse", "branch", "room"]), id: z.string().uuid().optional() })
  .refine((l) => l.kind === "warehouse" || !!l.id, { message: "Не указана локация" })

// INV-02: перемещение в любом направлении между складом/филиалом/кабинетом.
const transferAnySchema = z
  .object({
    type: z.literal("transfer"),
    stockItemId: z.string().uuid(),
    from: locationSchema,
    to: locationSchema,
    quantity: z.number().positive(),
    comment: z.string().optional(),
  })
  .refine((d) => !(d.from.kind === d.to.kind && (d.from.kind === "warehouse" || d.from.id === d.to.id)), {
    message: "Источник и приёмник совпадают",
  })

// INV-03: списание (расход товара). Из любой локации. Создаёт расход в ОПИУ
// (без счёта — деньги не двигаются, в ДДС не попадает). Поля как у «Нового расхода».
const writeOffSchema = z.object({
  type: z.literal("write_off"),
  stockItemId: z.string().uuid(),
  from: locationSchema,
  quantity: z.number().positive(),
  categoryId: z.string().uuid("Выберите статью расхода"),
  date: z.string().min(1, "Укажите дату списания"),
  branchIds: z.array(z.string().uuid()).optional().default([]),
  directionId: z.string().uuid().nullable().optional(),
  recognitionMode: z.enum(["by_payment_date", "single_period", "amortized"]).optional().default("by_payment_date"),
  amortizationStartDate: z.string().optional().nullable(),
  amortizationMonths: z.number().int().positive().optional().nullable(),
  comment: z.string().optional(),
})

const toLoc = (l: z.infer<typeof locationSchema>): Loc =>
  l.kind === "warehouse" ? { kind: "warehouse" } : { kind: l.kind, id: l.id! }

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId

  const [movements, branches, rooms] = await Promise.all([
    db.stockMovement.findMany({
      where: { tenantId },
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
  const roomMap = new Map(rooms.map((r) => [r.id, `${r.branch.name} · каб. ${r.name}`]))
  // Локация может быть общим складом (флаг), филиалом (branchId) или кабинетом (roomId).
  const label = (warehouse: boolean, branchId: string | null, roomId: string | null): string | null => {
    if (warehouse) return "Склад"
    if (branchId) return `Филиал · ${branchMap.get(branchId) ?? "—"}`
    if (roomId) return roomMap.get(roomId) ?? "Кабинет · —"
    return null
  }

  const enriched = movements.map((m) => ({
    ...m,
    fromLabel: label(m.fromWarehouse, m.fromBranchId, m.fromRoomId),
    toLabel: label(m.toWarehouse, m.toBranchId, m.toRoomId),
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

  // INV-01: внесение на общий склад. Без финансовых проводок.
  if (body.type === "purchase") {
    const parsed = purchaseSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
    const d = parsed.data
    const totalCost = round2(d.quantity * d.unitCost)

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

    await db.$transaction(async (tx) => {
      let itemId = resolvedItemId
      if (!itemId) {
        const created = await tx.stockItem.create({
          data: { tenantId, name: d.itemName!, unit: d.unit || "шт", defaultUnitCost: d.unitCost },
        })
        itemId = created.id
      }

      await tx.stockMovement.create({
        data: {
          tenantId,
          stockItemId: itemId,
          type: "purchase",
          quantity: d.quantity,
          unitCost: d.unitCost,
          totalCost,
          toWarehouse: true,
          date: new Date(),
          createdById: session.user.employeeId,
        },
      })

      await credit(tx, tenantId, itemId, { kind: "warehouse" }, d.quantity, totalCost)
    })

    return NextResponse.json({ success: true }, { status: 201 })
  }

  // INV-02: перемещение в любом направлении (склад↔филиал↔кабинет). Себестоимость
  // переносится по средней. Денег не двигает.
  if (body.type === "transfer") {
    const parsed = transferAnySchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
    const d = parsed.data
    const from = toLoc(d.from)
    const to = toLoc(d.to)

    try {
      await db.$transaction(async (tx) => {
        await assertItem(tx, tenantId, d.stockItemId)
        await assertLocation(tx, tenantId, from)
        await assertLocation(tx, tenantId, to)

        const { unitCost, totalCost } = await debit(tx, tenantId, d.stockItemId, from, d.quantity)
        await credit(tx, tenantId, d.stockItemId, to, d.quantity, totalCost)

        await tx.stockMovement.create({
          data: {
            tenantId,
            stockItemId: d.stockItemId,
            type: "transfer",
            quantity: d.quantity,
            unitCost,
            totalCost,
            ...fromColumns(from),
            ...toColumns(to),
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

  // INV-03: списание (израсходовали). Из любой локации. Создаёт расход в ОПИУ
  // (accountId = null — деньги не двигаются, в ДДС не идёт). Сумма = кол-во × средняя
  // себестоимость списываемого остатка.
  if (body.type === "write_off") {
    const parsed = writeOffSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
    const d = parsed.data
    const from = toLoc(d.from)
    const date = new Date(d.date)

    // Статья расхода (системная или тенантная, активная).
    const category = await db.expenseCategory.findFirst({
      where: { id: d.categoryId, isActive: true, OR: [{ tenantId }, { tenantId: null }] },
      select: { id: true, isVariable: true },
    })
    if (!category) return NextResponse.json({ error: "Статья расхода не найдена" }, { status: 404 })

    // Направление (если указано) — наше.
    let directionId: string | null = null
    if (d.directionId) {
      const dir = await db.direction.findFirst({ where: { id: d.directionId, tenantId, deletedAt: null }, select: { id: true } })
      if (!dir) return NextResponse.json({ error: "Направление не найдено" }, { status: 404 })
      directionId = dir.id
    }

    // Проверка закрытия периода (по дате списания).
    const role = (session.user as { role: string }).role
    if (await isPeriodLocked(tenantId, date, role)) {
      return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
    }

    // Режим признания в ОПИУ (как у обычного расхода, но без «не в финрезе»).
    let amortMonths: number | null = null
    let amortStart: Date | null = null
    if (d.recognitionMode === "single_period") {
      if (!d.amortizationStartDate) return NextResponse.json({ error: "Укажите месяц признания" }, { status: 400 })
      amortStart = new Date(d.amortizationStartDate); amortMonths = 1
    } else if (d.recognitionMode === "amortized") {
      if (!d.amortizationStartDate || !d.amortizationMonths || d.amortizationMonths < 2) {
        return NextResponse.json({ error: "Укажите месяц начала и количество месяцев (≥ 2)" }, { status: 400 })
      }
      if (d.amortizationMonths > 60) return NextResponse.json({ error: "Максимум 60 месяцев" }, { status: 400 })
      amortStart = new Date(d.amortizationStartDate); amortMonths = d.amortizationMonths
    }

    try {
      await db.$transaction(async (tx) => {
        await assertItem(tx, tenantId, d.stockItemId)
        await assertLocation(tx, tenantId, from)
        // Филиалы привязки расхода — наши.
        for (const bId of d.branchIds) {
          const b = await tx.branch.findFirst({ where: { id: bId, tenantId, deletedAt: null }, select: { id: true } })
          if (!b) throw new Error("LOCATION")
        }

        const { unitCost, totalCost } = await debit(tx, tenantId, d.stockItemId, from, d.quantity)

        // Расход в ОПИУ (без счёта/ДДС) — только если у списываемого есть стоимость.
        let expenseId: string | null = null
        if (totalCost > 0) {
          const expense = await tx.expense.create({
            data: {
              tenantId,
              categoryId: category.id,
              accountId: null,
              amount: totalCost,
              date,
              comment: d.comment ? `Списание товара: ${d.comment}` : "Списание товара со склада",
              isVariable: category.isVariable,
              recognitionMode: d.recognitionMode,
              amortizationMonths: amortMonths,
              amortizationStartDate: amortStart,
              createdBy: session.user.employeeId,
            },
          })
          expenseId = expense.id
          if (d.branchIds.length > 0) {
            await tx.expenseBranch.createMany({
              data: d.branchIds.map((branchId) => ({ tenantId, expenseId: expense.id, branchId, directionId })),
            })
          } else if (directionId) {
            await tx.expenseBranch.create({ data: { tenantId, expenseId: expense.id, branchId: null, directionId } })
          }
        }

        await tx.stockMovement.create({
          data: {
            tenantId,
            stockItemId: d.stockItemId,
            type: "write_off",
            quantity: d.quantity,
            unitCost,
            totalCost,
            ...fromColumns(from),
            expenseId,
            date,
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
