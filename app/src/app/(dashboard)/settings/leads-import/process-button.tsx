"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Upload, AlertCircle, Download } from "lucide-react"

interface Conflict {
  fio: string
  phone: string
  state: string
  reason: "child_in_lead_and_other" | "phone_has_lead_and_others"
  sourceRow: number
}

function reasonLabel(reason: Conflict["reason"]): string {
  return reason === "child_in_lead_and_other"
    ? "Один ребёнок в статусе «Лид» и в другом статусе"
    : "На одном телефоне «Лид» и другие статусы"
}

interface ImportStats {
  totalInput: number
  afterPriority: number
  afterDedup: number
  surnameChanged: number
  needsReview: number
  byStatus: Record<string, number>
}

export function ProcessLeadsButton() {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null)
  const [success, setSuccess] = useState<ImportStats | null>(null)

  function reset() {
    setFile(null); setError(null); setConflicts(null); setSuccess(null)
  }

  async function downloadConflicts() {
    if (!conflicts || conflicts.length === 0) return
    const XLSX = await import("xlsx")
    const rows = conflicts.map((c) => ({
      "Строка в файле": c.sourceRow,
      "ФИО": c.fio,
      "Телефон": c.phone || "",
      "Статус": c.state,
      "Причина": reasonLabel(c.reason),
    }))
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ["Строка в файле", "ФИО", "Телефон", "Статус", "Причина"],
    })
    ws["!cols"] = [{ wch: 13 }, { wch: 32 }, { wch: 16 }, { wch: 16 }, { wch: 50 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Проблемные клиенты")
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" })
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "Проблемные клиенты — импорт.xlsx"
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { setError("Выберите файл .xlsx"); return }
    setLoading(true); setError(null); setConflicts(null); setSuccess(null)

    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/leads-import/process", { method: "POST", body: fd })

      if (res.status === 409) {
        const data = await res.json()
        setConflicts(data.conflicts ?? [])
        setError(data.error ?? "Проблемные строки в данных")
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Ошибка ${res.status}`)
        return
      }

      // Парсим статистику из header'а
      const statsB64 = res.headers.get("X-Import-Stats")
      if (statsB64) {
        try {
          const json = atob(statsB64)
          setSuccess(JSON.parse(json) as ImportStats)
        } catch { /* ignore */ }
      }

      // Скачиваем файл
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "Список лидов — для импорта.xlsx"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline">
        <Upload className="size-4" />
        Загрузить Список лидов
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Этап 1. Обработка выгрузки 1С</DialogTitle>
            <DialogDescription>
              Загрузите файл <code>Список лидов.xlsx</code> с колонками: ФИО, Контактное лицо,
              Телефон, Соцсети, Дата рождения, Состояние лида. Получите файл
              <code> Список лидов — для импорта.xlsx</code> для вычитки.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Файл .xlsx</Label>
              <Input
                type="file"
                accept=".xlsx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-start gap-2">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {conflicts && conflicts.length > 0 && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">Проблемных строк: {conflicts.length}</div>
                  <Button type="button" variant="outline" size="sm" onClick={downloadConflicts}>
                    <Download className="size-4" />
                    Скачать таблицей
                  </Button>
                </div>
                <ul className="space-y-1 max-h-64 overflow-y-auto">
                  {conflicts.slice(0, 50).map((c, i) => (
                    <li key={i} className="text-xs">
                      <span className="text-muted-foreground">стр. {c.sourceRow}</span> ·{" "}
                      <span className="font-medium">{c.fio}</span> · {c.phone || "(нет телефона)"} ·{" "}
                      <span className="text-muted-foreground">{c.state}</span>{" "}
                      <span className="text-muted-foreground">
                        {c.reason === "child_in_lead_and_other"
                          ? "(один ребёнок в Лиде и другом статусе)"
                          : "(на одном телефоне Лид + другие)"}
                      </span>
                    </li>
                  ))}
                  {conflicts.length > 50 && (
                    <li className="text-xs text-muted-foreground">
                      … и ещё {conflicts.length - 50}. Полный список — в таблице выше.
                    </li>
                  )}
                </ul>
              </div>
            )}

            {success && (
              <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm space-y-1">
                <div className="font-medium text-emerald-700 dark:text-emerald-500">
                  Готово. Файл скачан.
                </div>
                <div className="text-xs text-muted-foreground">
                  Исходных строк: {success.totalInput} → после правил: {success.afterPriority} → итог:{" "}
                  {success.afterDedup}. Фамилий согласовано: {success.surnameChanged}. На проверку: {success.needsReview}.
                </div>
                <div className="text-xs text-muted-foreground">
                  По статусам: {Object.entries(success.byStatus)
                    .filter(([, n]) => n > 0)
                    .map(([s, n]) => `${s} — ${n}`)
                    .join(", ")}
                </div>
              </div>
            )}

            <DialogFooter>
              {success ? (
                <Button type="button" onClick={() => setOpen(false)}>
                  Закрыть
                </Button>
              ) : (
                <Button type="submit" disabled={loading || !file}>
                  {loading ? "Обработка…" : "Обработать и скачать"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
