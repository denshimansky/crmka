"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Coins, AlertCircle } from "lucide-react"

interface MissingClient {
  phone: string
  contractor: string
  target: number
}

interface UpdatedClient {
  phone: string
  clientId: string
  fullName: string
  oldBalance: number
  newBalance: number
  delta: number
}

interface SyncBalancesReport {
  rowsParsed: number
  rowsSkippedNoPhone: number
  rowsSkippedNoBalance: number
  phonesTotal: number
  matched: number
  updated: number
  unchanged: number
  missingInDb: MissingClient[]
  updatedClients: UpdatedClient[]
  totalTargetSum: number
  totalDeltaApplied: number
}

function fmt(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
}

export function SyncBalancesButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detectedHeaders, setDetectedHeaders] = useState<string[] | null>(null)
  const [report, setReport] = useState<SyncBalancesReport | null>(null)

  function reset() {
    setFile(null)
    setError(null)
    setDetectedHeaders(null)
    setReport(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      setError("Выберите файл «остатки.xlsx»")
      return
    }
    setLoading(true)
    setError(null)
    setDetectedHeaders(null)
    setReport(null)

    try {
      const fd = new FormData()
      fd.append("balancesFile", file)
      const res = await fetch("/api/leads-import/sync-balances", { method: "POST", body: fd })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Ошибка ${res.status}`)
        if (Array.isArray(data.detectedHeaders)) setDetectedHeaders(data.detectedHeaders)
        return
      }

      const data: SyncBalancesReport = await res.json()
      setReport(data)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Coins className="size-4" />
        Синхронизировать остатки
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Синхронизация остатков из 1С</DialogTitle>
            <DialogDescription className="space-y-2">
              <span>
                Загрузите файл <code>остатки.xlsx</code> с колонками
                {" "}<b>Телефон</b>, <b>Баланс на сегодня</b>{" "}
                (опционально <b>Контрагент</b> для отчёта о ненайденных).
              </span>
              <span className="block">
                Баланс каждого клиента будет <b>установлен ровно</b> к значению из файла
                (delta = target − current). Повторный запуск с тем же файлом — нулевые
                корректировки.
              </span>
              <span className="block text-emerald-600 dark:text-emerald-400">
                Операция не пишет в ДДС — это техническая корректировка
                Client.clientBalance (тип correction, с записью в историю баланса).
              </span>
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>остатки.xlsx <span className="text-destructive">*</span></Label>
              <Input
                type="file"
                accept=".xlsx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-start gap-2">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <div>{error}</div>
                  {detectedHeaders && detectedHeaders.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Распознанные заголовки: {detectedHeaders.map((h) => `«${h}»`).join(", ")}
                    </div>
                  )}
                </div>
              </div>
            )}

            {report && (
              <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm space-y-2">
                <div className="font-medium text-emerald-700 dark:text-emerald-500">
                  Синхронизация завершена
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <div>Строк в файле: <b>{report.rowsParsed}</b></div>
                  <div>Уникальных телефонов: <b>{report.phonesTotal}</b></div>
                  <div>Найдено в БД: <b>{report.matched}</b></div>
                  <div>Не найдено: <b>{report.missingInDb.length}</b></div>
                  <div>Обновлено балансов: <b>{report.updated}</b></div>
                  <div>Без изменений: <b>{report.unchanged}</b></div>
                  <div>Σ ожидаемых остатков: <b>{fmt(report.totalTargetSum)} ₽</b></div>
                  <div>Σ применённой Δ: <b>{fmt(report.totalDeltaApplied)} ₽</b></div>
                </div>
                {(report.rowsSkippedNoPhone > 0 || report.rowsSkippedNoBalance > 0) && (
                  <div className="text-xs text-muted-foreground">
                    Пропущено строк: без телефона — {report.rowsSkippedNoPhone},
                    без баланса — {report.rowsSkippedNoBalance}
                  </div>
                )}
                {report.missingInDb.length > 0 && (
                  <details className="text-xs text-muted-foreground mt-1">
                    <summary className="cursor-pointer">
                      Не найдены в БД по телефону ({report.missingInDb.length})
                    </summary>
                    <ul className="mt-1 list-disc pl-4 space-y-0.5 max-h-48 overflow-y-auto">
                      {report.missingInDb.slice(0, 200).map((m, i) => (
                        <li key={i}>
                          {m.phone} · {m.contractor || "(без имени)"} · ожидаемый {fmt(m.target)} ₽
                        </li>
                      ))}
                      {report.missingInDb.length > 200 && (
                        <li>… и ещё {report.missingInDb.length - 200}</li>
                      )}
                    </ul>
                  </details>
                )}
                {report.updatedClients.length > 0 && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">
                      Обновлённые клиенты ({report.updatedClients.length})
                    </summary>
                    <ul className="mt-1 list-disc pl-4 space-y-0.5 max-h-48 overflow-y-auto">
                      {report.updatedClients.slice(0, 200).map((u, i) => (
                        <li key={i}>
                          {u.fullName || u.phone}: {fmt(u.oldBalance)} → {fmt(u.newBalance)} ₽
                          {" "}(Δ {u.delta >= 0 ? "+" : ""}{fmt(u.delta)})
                        </li>
                      ))}
                      {report.updatedClients.length > 200 && (
                        <li>… и ещё {report.updatedClients.length - 200}</li>
                      )}
                    </ul>
                  </details>
                )}
              </div>
            )}

            <DialogFooter>
              {report ? (
                <Button type="button" onClick={() => setOpen(false)}>
                  Закрыть
                </Button>
              ) : (
                <Button type="submit" disabled={loading || !file}>
                  {loading ? "Синхронизация…" : "Запустить синхронизацию"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
