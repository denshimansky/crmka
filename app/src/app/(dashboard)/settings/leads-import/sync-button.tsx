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

interface CreatedWithoutPhone {
  rowIdx: number
  parent: string
  child: string
}

interface BranchNotFound {
  name: string
  count: number
}

interface SyncReport {
  leadsParsed: number
  moneyParsed: number
  clientsCreated: number
  clientsMerged: number
  wardsCreated: number
  clientsCreatedWithoutPhone: number
  withoutPhone: CreatedWithoutPhone[]
  totalBalance: number
  balanceMissing: number
  branchAssigned: number
  branchMissing: number
  warnings: string[]
}

export function SyncBalanceButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [leadsFile, setLeadsFile] = useState<File | null>(null)
  const [moneyFile, setMoneyFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detectedHeaders, setDetectedHeaders] = useState<string[] | null>(null)
  const [needsReview, setNeedsReview] = useState<NeedsReview[] | null>(null)
  const [branchNotFound, setBranchNotFound] = useState<BranchNotFound[] | null>(null)
  const [report, setReport] = useState<SyncReport | null>(null)

  function reset() {
    setLeadsFile(null); setMoneyFile(null)
    setError(null); setDetectedHeaders(null); setNeedsReview(null)
    setBranchNotFound(null); setReport(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!leadsFile) {
      setError("Выберите файл «Список лидов — для импорта.xlsx»"); return
    }
    setLoading(true); setError(null); setDetectedHeaders(null); setNeedsReview(null)
    setBranchNotFound(null); setReport(null)

    try {
      const fd = new FormData()
      fd.append("leadsFile", leadsFile)
      if (moneyFile) fd.append("moneyFile", moneyFile)
      const res = await fetch("/api/leads-import/sync", { method: "POST", body: fd })

      if (res.status === 422) {
        const data = await res.json()
        if (Array.isArray(data.branchNotFound)) {
          setBranchNotFound(data.branchNotFound)
          setError(data.error ?? "Есть филиалы, которых нет в CRM")
          return
        }
        setNeedsReview(data.needsReview ?? [])
        setError(data.error ?? "Есть строки на проверку")
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Ошибка ${res.status}`)
        if (Array.isArray(data.detectedHeaders)) setDetectedHeaders(data.detectedHeaders)
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
              Загрузите вычитанный <code>Список лидов — для импорта.xlsx</code>.
              Файл <code>деньги.xlsx</code> опционален: если не приложить —
              баланс существующих клиентов <b>не трогаем</b> (останется как был),
              новые создадутся с нулевым балансом. Дети одного телефона станут
              подопечными одного клиента (родителя), балансы суммируются.
              Филиалы из колонки «Филиал» должны быть заранее заведены в CRM
              с такими же названиями.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Список лидов — для импорта.xlsx <span className="text-destructive">*</span></Label>
              <Input
                type="file"
                accept=".xlsx"
                onChange={(e) => setLeadsFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>деньги.xlsx <span className="text-muted-foreground text-xs">(необязательно)</span></Label>
              <Input
                type="file"
                accept=".xlsx"
                onChange={(e) => setMoneyFile(e.target.files?.[0] ?? null)}
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

            {branchNotFound && branchNotFound.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">
                  Филиалов нет в CRM: {branchNotFound.length}
                </div>
                <div className="text-xs text-muted-foreground">
                  Создайте филиалы с такими же названиями в «Настройки → Филиалы» и запустите импорт снова.
                </div>
                <ul className="space-y-1">
                  {branchNotFound.map((b, i) => (
                    <li key={i} className="text-xs">
                      <span className="font-medium">{b.name}</span> · строк: {b.count}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report && (
              <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm space-y-1">
                <div className="font-medium text-emerald-700 dark:text-emerald-500">
                  Импорт завершён
                </div>
                <div className="text-xs text-muted-foreground">
                  Прочитано строк из «Список лидов»: {report.leadsParsed}
                  {report.moneyParsed > 0
                    ? ` · из «Деньги»: ${report.moneyParsed}`
                    : " · файл «Деньги» не загружен"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Создано клиентов: {report.clientsCreated} · объединено: {report.clientsMerged} ·
                  подопечных: {report.wardsCreated}
                </div>
                <div className="text-xs text-muted-foreground">
                  Суммарный баланс: {report.totalBalance.toLocaleString("ru-RU")} ₽ · без баланса:{" "}
                  {report.balanceMissing}
                </div>
                <div className="text-xs text-muted-foreground">
                  Филиал проставлен: {report.branchAssigned}
                  {report.branchMissing > 0 ? ` · без филиала: ${report.branchMissing}` : ""}
                </div>
                {report.clientsCreatedWithoutPhone > 0 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-900 dark:text-amber-200">
                    <div className="font-medium">
                      Создано без телефона: {report.clientsCreatedWithoutPhone}
                    </div>
                    <div className="text-amber-800/80 dark:text-amber-200/80">
                      В файле у этих строк колонка «Номер_телефона» была пустой. Проверьте исходник
                      и поправьте вручную, иначе клиентов нельзя будет найти по номеру.
                    </div>
                    {report.withoutPhone.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer">Показать ({report.withoutPhone.length})</summary>
                        <ul className="mt-1 list-disc pl-4 space-y-0.5">
                          {report.withoutPhone.slice(0, 50).map((w, i) => (
                            <li key={i}>
                              Строка {w.rowIdx}: {w.parent || "(без имени)"} — «{w.child}»
                            </li>
                          ))}
                          {report.withoutPhone.length > 50 && (
                            <li className="text-amber-800/60 dark:text-amber-200/60">
                              … и ещё {report.withoutPhone.length - 50}
                            </li>
                          )}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
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
              {report ? (
                <Button type="button" onClick={() => setOpen(false)}>
                  Закрыть
                </Button>
              ) : (
                <Button type="submit" disabled={loading || !leadsFile}>
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
