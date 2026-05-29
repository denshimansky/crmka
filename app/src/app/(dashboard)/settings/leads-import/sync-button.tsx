"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Wallet, AlertCircle } from "lucide-react"

interface NeedsReview {
  rowIdx: number
  fio: string
  phone: string
}

interface SyncReport {
  clientsCreated: number
  clientsMerged: number
  wardsCreated: number
  totalBalance: number
  balanceMissing: number
  warnings: string[]
}

export function SyncBalanceButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [leadsFile, setLeadsFile] = useState<File | null>(null)
  const [moneyFile, setMoneyFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsReview, setNeedsReview] = useState<NeedsReview[] | null>(null)
  const [report, setReport] = useState<SyncReport | null>(null)

  function reset() {
    setLeadsFile(null); setMoneyFile(null)
    setError(null); setNeedsReview(null); setReport(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!leadsFile || !moneyFile) {
      setError("Выберите оба файла"); return
    }
    setLoading(true); setError(null); setNeedsReview(null); setReport(null)

    try {
      const fd = new FormData()
      fd.append("leadsFile", leadsFile)
      fd.append("moneyFile", moneyFile)
      const res = await fetch("/api/leads-import/sync", { method: "POST", body: fd })

      if (res.status === 422) {
        const data = await res.json()
        setNeedsReview(data.needsReview ?? [])
        setError(data.error ?? "Есть строки на проверку")
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Ошибка ${res.status}`)
        return
      }

      const data: SyncReport = await res.json()
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
      <Button onClick={() => setOpen(true)}>
        <Wallet className="size-4" />
        Синхронизировать баланс
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Этап 2. Загрузка контактов в CRM</DialogTitle>
            <DialogDescription>
              Загрузите вычитанный <code>Список лидов — для импорта.xlsx</code> и
              <code> деньги.xlsx</code>. Дети одного телефона станут подопечными одного клиента
              (родителя), балансы суммируются.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Список лидов — для импорта.xlsx</Label>
              <Input
                type="file"
                accept=".xlsx"
                onChange={(e) => setLeadsFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>деньги.xlsx</Label>
              <Input
                type="file"
                accept=".xlsx"
                onChange={(e) => setMoneyFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-start gap-2">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {needsReview && needsReview.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">Требуют ручной правки: {needsReview.length}</div>
                <ul className="space-y-1">
                  {needsReview.slice(0, 50).map((r, i) => (
                    <li key={i} className="text-xs">
                      Строка {r.rowIdx}: <span className="font-medium">{r.fio}</span> · {r.phone || "(нет телефона)"}
                    </li>
                  ))}
                  {needsReview.length > 50 && (
                    <li className="text-xs text-muted-foreground">… и ещё {needsReview.length - 50}</li>
                  )}
                </ul>
              </div>
            )}

            {report && (
              <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm space-y-1">
                <div className="font-medium text-emerald-700 dark:text-emerald-500">
                  Импорт завершён
                </div>
                <div className="text-xs text-muted-foreground">
                  Создано клиентов: {report.clientsCreated} · объединено: {report.clientsMerged} ·
                  подопечных: {report.wardsCreated}
                </div>
                <div className="text-xs text-muted-foreground">
                  Суммарный баланс: {report.totalBalance.toLocaleString("ru-RU")} ₽ · без баланса:{" "}
                  {report.balanceMissing}
                </div>
                {report.warnings.length > 0 && (
                  <details className="text-xs text-muted-foreground mt-1">
                    <summary className="cursor-pointer">Предупреждения ({report.warnings.length})</summary>
                    <ul className="mt-1 list-disc pl-4 space-y-0.5">
                      {report.warnings.slice(0, 20).map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="submit" disabled={loading || !leadsFile || !moneyFile}>
                {loading ? "Синхронизация…" : "Запустить синхронизацию"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
