"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Download, Upload, FileSpreadsheet } from "lucide-react"

interface ImportResult {
  imported: number
  newItems: number
  existingItems: number
  skipped: number
  errors: string[]
}

const TEMPLATE_HEADERS = ["Название", "Единица измерения", "Количество", "Цена"]

// Диалог «Загрузить остатки» — перенос старых товаров при переезде на CRMka.
// Только владелец (кнопка показывается лишь ему). Шаблон Excel + загрузка файла
// на общий склад. На финансы (ДДС/ОПИУ) не влияет.
export function StockImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onImported: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  function reset() {
    setFile(null); setError(null); setResult(null); setUploading(false)
    if (inputRef.current) inputRef.current.value = ""
  }

  async function downloadTemplate() {
    const XLSX = await import("xlsx")
    const ws = XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      ["Бумага A4", "пачка", 10, 350],
      ["Краски акварельные", "шт", 25, 120],
    ])
    ws["!cols"] = [{ wch: 32 }, { wch: 20 }, { wch: 14 }, { wch: 12 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Остатки")
    XLSX.writeFile(wb, "shablon-ostatkov.xlsx")
  }

  async function handleUpload() {
    if (!file) { setError("Выберите файл"); return }
    setUploading(true); setError(null); setResult(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/stock-import", { method: "POST", body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || "Ошибка загрузки"); return }
      setResult(data as ImportResult)
      // Сбрасываем файл, чтобы повторный клик случайно не задвоил остатки
      // (загрузка суммирует количества). Для повтора нужно выбрать файл заново.
      setFile(null)
      if (inputRef.current) inputRef.current.value = ""
      onImported()
    } catch {
      setError("Ошибка сети")
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Загрузить остатки</DialogTitle>
          <DialogDescription>
            Перенос складских остатков старых товаров при переезде на CRMka. Все товары
            попадут на общий склад. На финансы (ДДС, ОПИУ) загрузка не влияет.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Шаг 1 — шаблон */}
          <div className="rounded-md border p-3 space-y-2">
            <p className="text-sm font-medium">1. Скачайте шаблон</p>
            <p className="text-xs text-muted-foreground">
              Столбцы: <b>Название</b>, <b>Единица измерения</b>, <b>Количество</b>, <b>Цена</b>.
              Количество и цена — числа (дробные через запятую или точку). Строки-примеры удалите.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="size-4 mr-1" /> Скачать шаблон Excel
            </Button>
          </div>

          {/* Шаг 2 — файл */}
          <div className="rounded-md border p-3 space-y-2">
            <p className="text-sm font-medium">2. Загрузите заполненный файл</p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setError(null) }}
            />
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                <FileSpreadsheet className="size-4 mr-1" /> Выбрать файл
              </Button>
              {file && <span className="text-xs text-muted-foreground truncate max-w-[60%]">{file.name}</span>}
            </div>
            <p className="text-xs text-muted-foreground">
              Загрузка <b>суммирует</b> количества с уже имеющимися на складе — не загружайте один и тот же файл дважды.
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}

          {result && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm space-y-1">
              <p>
                Загружено позиций: <b>{result.imported}</b>{" "}
                <span className="text-muted-foreground">
                  (новых товаров: {result.newItems}, пополнено: {result.existingItems})
                </span>
              </p>
              {result.skipped > 0 && (
                <p className="text-muted-foreground">Пропущено строк: {result.skipped}.</p>
              )}
              {result.errors.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Ошибки ({result.errors.length})</summary>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5 max-h-40 overflow-auto">
                    {result.errors.slice(0, 100).map((er, i) => <li key={i}>{er}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {result ? "Закрыть" : "Отмена"}
            </Button>
            <Button type="button" onClick={handleUpload} disabled={uploading || !file}>
              <Upload className="size-4 mr-1" /> {uploading ? "Загрузка..." : "Загрузить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
