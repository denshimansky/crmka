import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import * as XLSX from "xlsx"

// POST /api/stock-import — загрузка складских остатков при переезде на CRMka.
// ТОЛЬКО владелец. Все товары попадают на общий склад — ровно как «Внести на
// склад» (движение type=purchase): расход НЕ создаётся, поэтому в ДДС/ОПИУ и
// прочих финансовых отчётах эти остатки не отображаются.
// Файл — Excel (.xlsx/.xls) или CSV со столбцами:
//   «Название», «Единица измерения», «Количество», «Цена».

const round2 = (n: number) => Math.round(n * 100) / 100

// Число из ячейки: поддерживаем «1 234,56», «1234.56» и числовой тип Excel.
function parseNum(v: unknown): number {
  if (typeof v === "number") return v
  const s = String(v ?? "").trim().replace(/\s/g, "").replace(",", ".")
  if (!s) return NaN
  return Number(s)
}

// Нормализация заголовка: без регистра, лишних и краевых пробелов.
// Иначе «Название », «НАЗВАНИЕ», « Цена » из чужой выгрузки молча терялись бы.
function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

// Карта нормализованный-заголовок → значение (по одной строке).
function normRow(row: Record<string, unknown>): Map<string, string> {
  const m = new Map<string, string>()
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || v === null) continue
    const val = String(v).trim()
    if (val === "") continue
    const nk = normKey(k)
    if (!m.has(nk)) m.set(nk, val)
  }
  return m
}

// Значение поля по заголовку (с синонимами, без учёта регистра/пробелов), пустое — "".
function getField(nrow: Map<string, string>, aliases: string[]): string {
  for (const a of aliases) {
    const v = nrow.get(normKey(a))
    if (v !== undefined && v !== "") return v
  }
  return ""
}

const NAME_ALIASES = ["Название", "Наименование", "Товар", "name", "Name"]
const UNIT_ALIASES = ["Единица измерения", "Ед. изм.", "Ед.изм.", "Единица", "Ед", "unit", "Unit"]
const QTY_ALIASES = ["Количество", "Кол-во", "Колво", "quantity", "qty", "Quantity"]
const PRICE_ALIASES = ["Цена", "Цена за ед.", "Цена за единицу", "Стоимость", "price", "Price"]

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Загрузка остатков доступна только владельцу" }, { status: 403 })
  }
  const tenantId = session.user.tenantId

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  if (!file) return NextResponse.json({ error: "Файл не выбран" }, { status: 400 })

  // Читаем книгу (XLSX/XLS/CSV — SheetJS определяет формат сам).
  let rows: Record<string, unknown>[] = []
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: "buffer" })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return NextResponse.json({ error: "Пустой файл" }, { status: 400 })
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" })
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать файл. Используйте шаблон Excel." }, { status: 400 })
  }
  if (rows.length === 0) return NextResponse.json({ error: "Нет данных для загрузки" }, { status: 400 })
  if (rows.length > 10000) {
    return NextResponse.json({ error: "Слишком большой файл (макс. 10000 строк). Разбейте на части." }, { status: 400 })
  }

  // Разбор и валидация строк (до транзакции — невалидные не отменяют валидные).
  type Parsed = { name: string; unit: string; quantity: number; price: number }
  const parsed: Parsed[] = []
  const errors: string[] = []
  let skipped = 0

  for (let i = 0; i < rows.length; i++) {
    const nrow = normRow(rows[i])
    const rowNum = i + 2 // +1 заголовок, +1 единичная нумерация
    const name = getField(nrow, NAME_ALIASES)
    const qtyRaw = getField(nrow, QTY_ALIASES)
    const priceRaw = getField(nrow, PRICE_ALIASES)

    // Полностью пустая строка — молча пропускаем.
    if (!name && !qtyRaw && !priceRaw) continue
    if (!name) { errors.push(`Строка ${rowNum}: нет названия`); skipped++; continue }

    const quantity = parseNum(qtyRaw)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push(`Строка ${rowNum} (${name}): некорректное количество`); skipped++; continue
    }

    const price = priceRaw === "" ? 0 : parseNum(priceRaw)
    if (!Number.isFinite(price) || price < 0) {
      errors.push(`Строка ${rowNum} (${name}): некорректная цена`); skipped++; continue
    }

    const unit = getField(nrow, UNIT_ALIASES) || "шт"
    parsed.push({ name, unit, quantity, price })
  }

  if (parsed.length === 0) {
    return NextResponse.json({ imported: 0, newItems: 0, existingItems: 0, skipped, errors }, { status: 200 })
  }

  // Существующие товары — чтобы пополнять остаток, а не плодить дубли (без учёта регистра).
  const existing = await db.stockItem.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
  })
  const nameToId = new Map<string, string>()
  for (const it of existing) nameToId.set(it.name.trim().toLowerCase(), it.id)

  let newItems = 0
  let existingItems = 0

  try {
    await db.$transaction(
      async (tx) => {
        for (const p of parsed) {
          const key = p.name.toLowerCase()
          let itemId = nameToId.get(key)
          if (!itemId) {
            const created = await tx.stockItem.create({
              data: { tenantId, name: p.name, unit: p.unit, defaultUnitCost: p.price },
            })
            itemId = created.id
            nameToId.set(key, itemId)
            newItems++
          } else {
            existingItems++
          }

          const totalCost = round2(p.quantity * p.price)

          // Движение «внесение на общий склад». Расход НЕ создаётся → не в ДДС/ОПИУ.
          await tx.stockMovement.create({
            data: {
              tenantId,
              stockItemId: itemId,
              type: "purchase",
              quantity: p.quantity,
              unitCost: p.price,
              totalCost,
              toWarehouse: true,
              date: new Date(),
              comment: "Загрузка остатков при переезде",
              createdById: session.user.employeeId,
            },
          })

          // Зачисление на общий склад (создаём баланс, если ещё нет).
          await tx.warehouseBalance.upsert({
            where: { tenantId_stockItemId: { tenantId, stockItemId: itemId } },
            create: { tenantId, stockItemId: itemId, quantity: p.quantity, totalCost },
            update: { quantity: { increment: p.quantity }, totalCost: { increment: totalCost } },
          })
        }
      },
      { timeout: 120000, maxWait: 10000 },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Ошибка загрузки: ${msg.slice(0, 200)}` }, { status: 500 })
  }

  return NextResponse.json({ imported: parsed.length, newItems, existingItems, skipped, errors }, { status: 200 })
}
