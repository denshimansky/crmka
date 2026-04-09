import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import * as XLSX from "xlsx"

interface ImportRow {
  lastName?: string
  firstName?: string
  phone?: string
  email?: string
  channel?: string
  comment?: string
  wardName?: string
  wardBirthDate?: string
}

// POST /api/clients/import — импорт клиентов из CSV/XLSX
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (session.user.role !== "owner" && session.user.role !== "manager" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const tenantId = session.user.tenantId

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  const mappingRaw = formData.get("mapping") as string | null

  if (!file) {
    return NextResponse.json({ error: "Файл не выбран" }, { status: 400 })
  }

  // Парсим маппинг колонок
  let mapping: Record<string, string> = {}
  if (mappingRaw) {
    try {
      mapping = JSON.parse(mappingRaw)
    } catch {
      return NextResponse.json({ error: "Некорректный маппинг колонок" }, { status: 400 })
    }
  }

  // Читаем файл
  const buffer = Buffer.from(await file.arrayBuffer())
  let rows: Record<string, string>[] = []

  const fileName = file.name.toLowerCase()
  if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
    const workbook = XLSX.read(buffer, { type: "buffer" })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return NextResponse.json({ error: "Пустой файл" }, { status: 400 })
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" })
  } else {
    // CSV — поддерживаем ; и , как разделители
    const text = buffer.toString("utf-8")
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) return NextResponse.json({ error: "Файл пуст или содержит только заголовки" }, { status: 400 })

    const delimiter = lines[0].includes(";") ? ";" : ","
    const headers = parseCSVLine(lines[0], delimiter)

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i], delimiter)
      const row: Record<string, string> = {}
      headers.forEach((h, idx) => {
        row[h] = values[idx] || ""
      })
      rows.push(row)
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "Нет данных для импорта" }, { status: 400 })
  }

  // Применяем маппинг: mapping[targetField] = sourceColumn
  function getField(row: Record<string, string>, targetField: string): string {
    const sourceCol = mapping[targetField]
    if (sourceCol && row[sourceCol] !== undefined) return row[sourceCol].trim()
    // Пробуем найти по стандартным именам
    const aliases: Record<string, string[]> = {
      lastName: ["Фамилия", "lastName", "LastName", "фамилия", "last_name"],
      firstName: ["Имя", "firstName", "FirstName", "имя", "first_name"],
      phone: ["Телефон", "phone", "Phone", "телефон", "тел"],
      email: ["Email", "email", "EMAIL", "Почта", "почта", "e-mail"],
      channel: ["Канал", "channel", "Channel", "канал", "Источник", "источник"],
      comment: ["Комментарий", "comment", "Comment", "комментарий", "Примечание"],
      wardName: ["Подопечный (имя)", "wardName", "Подопечный", "подопечный", "Ребёнок", "ребёнок", "Ребенок"],
      wardBirthDate: ["Подопечный (ДР)", "wardBirthDate", "ДР подопечного", "ДР ребёнка", "ДР ребенка"],
    }
    for (const alias of aliases[targetField] || []) {
      if (row[alias] !== undefined && row[alias].trim()) return row[alias].trim()
    }
    return ""
  }

  // Получить существующие телефоны для проверки дублей
  const existingClients = await db.client.findMany({
    where: { tenantId, deletedAt: null, phone: { not: null } },
    select: { phone: true },
  })
  const existingPhones = new Set(existingClients.map((c) => normalizePhone(c.phone!)))

  // Получить каналы привлечения
  const channels = await db.leadChannel.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true },
  })
  const channelMap = new Map(channels.map((c) => [c.name.toLowerCase(), c.id]))

  let imported = 0
  let skipped = 0
  const errors: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2 // +1 for header, +1 for 1-based

    const data: ImportRow = {
      lastName: getField(row, "lastName"),
      firstName: getField(row, "firstName"),
      phone: getField(row, "phone"),
      email: getField(row, "email"),
      channel: getField(row, "channel"),
      comment: getField(row, "comment"),
      wardName: getField(row, "wardName"),
      wardBirthDate: getField(row, "wardBirthDate"),
    }

    // Нужен хотя бы телефон
    if (!data.phone) {
      errors.push(`Строка ${rowNum}: нет телефона`)
      continue
    }

    // Проверка дубля
    const normPhone = normalizePhone(data.phone)
    if (existingPhones.has(normPhone)) {
      skipped++
      continue
    }

    // Ищем канал
    let channelId: string | undefined
    if (data.channel) {
      channelId = channelMap.get(data.channel.toLowerCase())
    }

    try {
      await db.client.create({
        data: {
          tenantId,
          firstName: data.firstName || undefined,
          lastName: data.lastName || undefined,
          phone: data.phone,
          email: data.email || undefined,
          channelId,
          comment: data.comment || undefined,
          funnelStatus: "new",
          createdBy: session.user.employeeId,
          wards: data.wardName
            ? {
                create: {
                  tenantId,
                  firstName: data.wardName,
                  birthDate: data.wardBirthDate ? parseDate(data.wardBirthDate) : undefined,
                },
              }
            : undefined,
        },
      })

      existingPhones.add(normPhone)
      imported++
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`Строка ${rowNum}: ${msg.slice(0, 100)}`)
    }
  }

  return NextResponse.json({ imported, skipped, errors })
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "")
}

function parseDate(str: string): Date | undefined {
  // Поддерживаем DD.MM.YYYY и YYYY-MM-DD
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    const [d, m, y] = str.split(".")
    return new Date(`${y}-${m}-${d}`)
  }
  const d = new Date(str)
  return isNaN(d.getTime()) ? undefined : d
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim())
      current = ""
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}
