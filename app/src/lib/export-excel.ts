import * as XLSX from "xlsx"

interface ExportColumn {
  header: string
  key: string
  width?: number
}

interface ExportOptions {
  title: string
  columns: ExportColumn[]
  rows: Record<string, any>[]
  filename: string
  sheetName?: string
  metadata?: {
    org?: string
    period?: string
    generated?: string
  }
}

export function exportToExcel({
  title,
  columns,
  rows,
  filename,
  sheetName = "Отчёт",
  metadata,
}: ExportOptions) {
  const wb = XLSX.utils.book_new()
  const wsData: any[][] = []

  // Заголовок
  wsData.push([title])

  // Метаданные
  if (metadata) {
    if (metadata.org) wsData.push(["Организация:", metadata.org])
    if (metadata.period) wsData.push(["Период:", metadata.period])
    if (metadata.generated) wsData.push(["Сформирован:", metadata.generated])
  }

  // Пустая строка
  wsData.push([])

  // Заголовки столбцов
  wsData.push(columns.map((c) => c.header))

  // Данные
  for (const row of rows) {
    wsData.push(columns.map((c) => row[c.key] ?? ""))
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Ширины столбцов
  ws["!cols"] = columns.map((c) => ({ wch: c.width || 18 }))

  // Merge для заголовка (на всю ширину)
  if (columns.length > 1) {
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: columns.length - 1 } }]
  }

  XLSX.utils.book_append_sheet(wb, ws, sheetName)

  // Скачать
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`)
}
