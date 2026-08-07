"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Upload, AlertCircle, Download } from "lucide-react"
import { useCurrencySymbol } from "@/components/currency-provider"
import { TEMPLATE_HREF, TEMPLATE_FILENAME } from "./template-meta"

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

interface NoContactsRow {
  rowIdx: number
  parent: string
  child: string
}

interface MultiRowBalanceClient {
  parent: string
  phone: string
  rows: number
  total: number
}

interface SyncReport {
  leadsParsed: number
  duplicateRowsCollapsed: number
  moneyParsed: number
  clientsCreated: number
  clientsMerged: number
  wardsCreated: number
  clientsCreatedWithoutPhone: number
  withoutPhone: CreatedWithoutPhone[]
  multiRowBalanceCount: number
  multiRowBalance: MultiRowBalanceClient[]
  totalBalance: number
  balanceMissing: number
  branchAssigned: number
  branchMissing: number
  branchCorrected: number
  branchConflicts: number
  warnings: string[]
}

export function ImportTemplateButton() {
  const router = useRouter()
  const sym = useCurrencySymbol()
  const [open, setOpen] = useState(false)
  const [leadsFile, setLeadsFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detectedHeaders, setDetectedHeaders] = useState<string[] | null>(null)
  const [needsReview, setNeedsReview] = useState<NeedsReview[] | null>(null)
  const [branchNotFound, setBranchNotFound] = useState<BranchNotFound[] | null>(null)
  const [noContacts, setNoContacts] = useState<NoContactsRow[] | null>(null)
  const [report, setReport] = useState<SyncReport | null>(null)

  function reset() {
    setLeadsFile(null)
    setError(null); setDetectedHeaders(null); setNeedsReview(null)
    setBranchNotFound(null); setNoContacts(null); setReport(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!leadsFile) {
      setError(`Выберите заполненный шаблон «${TEMPLATE_FILENAME}»`); return
    }
    setLoading(true); setError(null); setDetectedHeaders(null); setNeedsReview(null)
    setBranchNotFound(null); setNoContacts(null); setReport(null)

    try {
      const fd = new FormData()
      fd.append("leadsFile", leadsFile)
      const res = await fetch("/api/leads-import/sync", { method: "POST", body: fd })

      if (res.status === 422) {
        const data = await res.json()
        if (Array.isArray(data.noContacts)) {
          setNoContacts(data.noContacts)
          setError(data.error ?? "Есть строки без телефона и соцсетей")
          return
        }
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
        <Upload className="size-4" />
        Импорт клиента по шаблону
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Импорт клиента по шаблону</DialogTitle>
            <DialogDescription>
              Заполните лист <code>Клиенты</code> и загрузите файл обратно. Обязательны{" "}
              <b>Ребёнок</b> и <b>Статус</b>, а также хотя бы один контакт — телефон{" "}
              <b>или</b> соцсети. Дети одного телефона становятся подопечными одного
              клиента-родителя. <b>Балансы этот шаг не грузит</b> — для них есть отдельный
              шаг «Обновить остатки» (ставит баланс точно по телефону). Филиалы из колонки
              «Филиал» заведите в CRM заранее с такими же названиями.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <a
              href={TEMPLATE_HREF}
              download={TEMPLATE_FILENAME}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              <Download className="size-4" />
              Скачать шаблон «{TEMPLATE_FILENAME}»
            </a>
            <div className="space-y-1.5">
              <Label>Заполненный шаблон <span className="text-destructive">*</span></Label>
              <Input
                type="file"
                accept=".xlsx"
                onChange={(e) => setLeadsFile(e.target.files?.[0] ?? null)}
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

            {noContacts && noContacts.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">Без телефона и соцсетей: {noContacts.length}</div>
                <div className="text-xs text-muted-foreground">
                  Заполните в файле телефон или соцсети у этих строк (или удалите их) и загрузите снова.
                </div>
                <ul className="space-y-1">
                  {noContacts.slice(0, 50).map((r, i) => (
                    <li key={i} className="text-xs">
                      Строка {r.rowIdx}: <span className="font-medium">{r.parent || "(без имени)"}</span>
                      {" — "}«{r.child}»
                    </li>
                  ))}
                  {noContacts.length > 50 && (
                    <li className="text-xs text-muted-foreground">… и ещё {noContacts.length - 50}</li>
                  )}
                </ul>
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
                  Прочитано строк из шаблона: {report.leadsParsed}
                  {report.duplicateRowsCollapsed > 0
                    ? ` · схлопнуто дублей строк: ${report.duplicateRowsCollapsed}`
                    : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  Создано клиентов: {report.clientsCreated} · объединено: {report.clientsMerged} ·
                  подопечных: {report.wardsCreated}
                </div>
                <div className="text-xs text-muted-foreground">
                  Суммарный баланс: {report.totalBalance.toLocaleString("ru-RU")} {sym} · без баланса:{" "}
                  {report.balanceMissing}
                </div>
                <div className="text-xs text-muted-foreground">
                  Филиал проставлен: {report.branchAssigned}
                  {report.branchCorrected > 0 ? ` · обновлён по файлу: ${report.branchCorrected}` : ""}
                  {report.branchConflicts > 0 ? ` · расхождений (с абонементами): ${report.branchConflicts}` : ""}
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
                {report.multiRowBalanceCount > 0 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-900 dark:text-amber-200">
                    <div className="font-medium">
                      Баланс сложен из нескольких строк: {report.multiRowBalanceCount}{" "}
                      {report.multiRowBalanceCount === 1 ? "клиент" : "клиента(ов)"}
                    </div>
                    <div className="text-amber-800/80 dark:text-amber-200/80">
                      У этих клиентов «Баланс» был заполнен в нескольких строках, и суммы
                      сложились. Если это была одна и та же сумма, продублированная по строкам —
                      баланс задвоен. Проверьте: очистите у них столбец «Баланс» в файле,
                      перезалейте, а деньги внесите вручную через «Пополнение баланса» в карточке.
                    </div>
                    {report.multiRowBalance.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer">Показать ({report.multiRowBalance.length})</summary>
                        <ul className="mt-1 list-disc pl-4 space-y-0.5">
                          {report.multiRowBalance.slice(0, 50).map((m, i) => (
                            <li key={i}>
                              {m.parent} ({m.phone || "без тел."}) — {m.rows} строк, итого{" "}
                              {m.total.toLocaleString("ru-RU")} {sym}
                            </li>
                          ))}
                          {report.multiRowBalance.length > 50 && (
                            <li className="text-amber-800/60 dark:text-amber-200/60">
                              … и ещё {report.multiRowBalance.length - 50}
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
                  {loading ? "Импорт…" : "Загрузить и импортировать"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
