"use client"

import { useState, useRef, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHelp } from "@/components/page-help"
import { Upload, Download, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react"

const TARGET_FIELDS = [
  { value: "", label: "— Не импортировать —" },
  { value: "lastName", label: "Фамилия" },
  { value: "firstName", label: "Имя" },
  { value: "phone", label: "Телефон" },
  { value: "email", label: "Email" },
  { value: "channel", label: "Канал" },
  { value: "comment", label: "Комментарий" },
  { value: "wardName", label: "Подопечный (имя)" },
  { value: "wardBirthDate", label: "Подопечный (ДР)" },
]

// Автоопределение маппинга
const AUTO_MAP: Record<string, string> = {
  "фамилия": "lastName",
  "lastname": "lastName",
  "last_name": "lastName",
  "имя": "firstName",
  "firstname": "firstName",
  "first_name": "firstName",
  "телефон": "phone",
  "тел": "phone",
  "phone": "phone",
  "email": "email",
  "почта": "email",
  "e-mail": "email",
  "канал": "channel",
  "источник": "channel",
  "channel": "channel",
  "комментарий": "comment",
  "comment": "comment",
  "примечание": "comment",
  "подопечный": "wardName",
  "подопечный (имя)": "wardName",
  "ребёнок": "wardName",
  "ребенок": "wardName",
  "подопечный (др)": "wardBirthDate",
  "др подопечного": "wardBirthDate",
  "др ребёнка": "wardBirthDate",
  "др ребенка": "wardBirthDate",
}

interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [previewRows, setPreviewRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({}) // targetField -> sourceColumn
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (f: File) => {
    setFile(f)
    setResult(null)

    const fileName = f.name.toLowerCase()
    const buffer = await f.arrayBuffer()

    let parsedHeaders: string[] = []
    let parsedRows: string[][] = []

    if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      const XLSX = await import("xlsx")
      const workbook = XLSX.read(buffer, { type: "array" })
      const sheetName = workbook.SheetNames[0]
      if (!sheetName) return
      const sheet = workbook.Sheets[sheetName]
      const json: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })
      if (json.length > 0) {
        parsedHeaders = json[0].map(String)
        parsedRows = json.slice(1, 11).map((row) => row.map(String))
      }
    } else {
      // CSV
      const text = new TextDecoder("utf-8").decode(buffer)
      const lines = text.split(/\r?\n/).filter((l) => l.trim())
      if (lines.length === 0) return

      const delimiter = lines[0].includes(";") ? ";" : ","
      parsedHeaders = parseCSVLine(lines[0], delimiter)
      for (let i = 1; i < Math.min(lines.length, 11); i++) {
        parsedRows.push(parseCSVLine(lines[i], delimiter))
      }
    }

    setHeaders(parsedHeaders)
    setPreviewRows(parsedRows)

    // Автомаппинг
    const autoMapping: Record<string, string> = {}
    for (const header of parsedHeaders) {
      const key = header.toLowerCase().trim()
      if (AUTO_MAP[key]) {
        autoMapping[AUTO_MAP[key]] = header
      }
    }
    setMapping(autoMapping)
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
    const f = e.dataTransfer.files[0]
    if (f) processFile(f)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) processFile(f)
  }

  function updateMapping(targetField: string, sourceColumn: string) {
    setMapping((prev) => {
      const next = { ...prev }
      // Remove existing mapping for this targetField
      if (sourceColumn === "") {
        delete next[targetField]
      } else {
        next[targetField] = sourceColumn
      }
      return next
    })
  }

  function getColumnMapping(colName: string): string {
    // Найти, на какой targetField замаплена эта колонка
    for (const [target, source] of Object.entries(mapping)) {
      if (source === colName) return target
    }
    return ""
  }

  async function handleImport() {
    if (!file) return
    setImporting(true)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("mapping", JSON.stringify(mapping))

      const res = await fetch("/api/clients/import", {
        method: "POST",
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) {
        setResult({ imported: 0, skipped: 0, errors: [data.error || "Ошибка импорта"] })
        return
      }

      setResult(data)
    } finally {
      setImporting(false)
    }
  }

  function downloadTemplate() {
    const headers = "Фамилия;Имя;Телефон;Email;Канал;Комментарий;Подопечный (имя);Подопечный (ДР)"
    const example = "Иванова;Мария;+79001234567;maria@example.com;Сайт;Пробное занятие;Даша;15.03.2018"
    const content = `\uFEFF${headers}\n${example}\n`
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "шаблон_импорта_клиентов.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Импорт клиентов</h1>
          <PageHelp pageKey="crm/import" />
        </div>
        <Button variant="outline" onClick={downloadTemplate}>
          <Download className="mr-1 size-4" />
          Скачать шаблон
        </Button>
      </div>

      {/* Drop zone */}
      {!file && (
        <Card>
          <CardContent
            className={`flex flex-col items-center gap-4 py-12 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
              dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-10 text-muted-foreground" />
            <div className="text-center">
              <p className="text-sm font-medium">
                Перетащите файл сюда или нажмите для выбора
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Поддерживаются CSV и Excel (.xlsx)
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={handleFileInput}
            />
          </CardContent>
        </Card>
      )}

      {/* File loaded — preview & mapping */}
      {file && headers.length > 0 && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="size-4 text-muted-foreground" />
                  <span>{file.name}</span>
                  <Badge variant="secondary">{previewRows.length} строк (preview)</Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFile(null)
                    setHeaders([])
                    setPreviewRows([])
                    setMapping({})
                    setResult(null)
                  }}
                >
                  Выбрать другой файл
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Column mapping */}
              <div className="mb-4 space-y-2">
                <p className="text-sm font-medium">Маппинг колонок:</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {headers.map((header) => (
                    <div key={header} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground truncate min-w-[80px]">
                        {header}:
                      </span>
                      <Select
                        value={getColumnMapping(header)}
                        onValueChange={(val) => {
                          // Удалить старый маппинг для этого header
                          const oldTarget = getColumnMapping(header)
                          if (oldTarget) updateMapping(oldTarget, "")
                          // Установить новый
                          if (val) updateMapping(val, header)
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Не импортировать" />
                        </SelectTrigger>
                        <SelectContent>
                          {TARGET_FIELDS.map((f) => (
                            <SelectItem key={f.value} value={f.value || "_skip"}>
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview table */}
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      {headers.map((h) => (
                        <TableHead key={h} className="text-xs">
                          {h}
                          {getColumnMapping(h) && (
                            <Badge variant="outline" className="ml-1 text-[10px]">
                              {TARGET_FIELDS.find((f) => f.value === getColumnMapping(h))?.label}
                            </Badge>
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                        {row.map((cell, j) => (
                          <TableCell key={j} className="text-xs max-w-[200px] truncate">
                            {cell}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Import button */}
          <div className="flex justify-end gap-3">
            <Button
              onClick={handleImport}
              disabled={importing || !mapping.phone}
              size="lg"
            >
              {importing ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : (
                <Upload className="mr-1 size-4" />
              )}
              Импортировать
            </Button>
          </div>
          {!mapping.phone && (
            <p className="text-sm text-destructive text-right">
              Укажите колонку с телефоном — это обязательное поле
            </p>
          )}
        </>
      )}

      {/* Result */}
      {result && (
        <Card>
          <CardContent className="py-6 space-y-3">
            <div className="flex items-center gap-3">
              {result.imported > 0 ? (
                <CheckCircle2 className="size-6 text-green-500" />
              ) : (
                <AlertTriangle className="size-6 text-yellow-500" />
              )}
              <div>
                <p className="font-medium">
                  Импортировано: {result.imported}
                </p>
                {result.skipped > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Пропущено дубликатов: {result.skipped}
                  </p>
                )}
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">
                  Ошибки ({result.errors.length}):
                </p>
                <div className="max-h-40 overflow-y-auto rounded-md bg-muted p-3 text-xs space-y-1">
                  {result.errors.map((err, i) => (
                    <p key={i}>{err}</p>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
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
