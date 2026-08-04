"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Plus, Trash2, ArrowLeft, Sparkles } from "lucide-react"
import { PageHelp } from "@/components/page-help"
import { StickyHScroll } from "@/components/sticky-h-scroll"
import { useCurrencySymbol } from "@/components/currency-provider"
import { OpiuRecognitionFieldset, type OpiuRecognitionState } from "@/components/opiu-recognition-fieldset"
import { resolveRecognition, type RecognitionPayload } from "@/lib/expense-recognition"

interface AccountOption {
  id: string
  name: string
}

interface DirectionOption {
  id: string
  name: string
}

interface AccrualByDirection {
  directionId: string | null
  directionName: string
  amount: number
  paid: number
  remaining: number
}

interface AccrualRow {
  employeeId: string
  employeeName: string
  role: string
  accrued: number
  bonuses: number
  penalties: number
  adjNet: number
  adjPaid: number
  adjRemaining: number
  alreadyPaid: number
  remaining: number
  byDirection: AccrualByDirection[]
}

interface ItemRow {
  uid: string
  employeeId: string
  employeeName: string
  directionId: string | null
  directionName: string
  accruedHint: number
  paidHint: number
  // Остаток к выплате на момент автозаполнения (для предупреждения о переплате).
  // null — строка добавлена вручную, остаток неизвестен.
  remainingHint: number | null
  amount: string
  accountId: string
  comment: string
}

const MONTH_NAMES = ["январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

// Сумма в строке больше остатка на момент автозаполнения — будет переплата.
function isOverpaid(it: ItemRow): boolean {
  return it.remainingHint !== null && (Number(it.amount) || 0) > it.remainingHint + 0.001
}

// useSearchParams в клиентской странице требует Suspense-границу при сборке.
export default function NewSalaryPaymentPage() {
  return (
    <Suspense fallback={null}>
      <NewSalaryPaymentForm />
    </Suspense>
  )
}

function monthLastDayIso(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

function NewSalaryPaymentForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const currencySym = useCurrencySymbol()
  // Символ валюты организации; числовой формат (копейки, ru-RU) не меняем.
  const formatMoney = (amount: number): string =>
    new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount) + " " + currencySym
  const now = new Date()
  // Локальная дата (не UTC): ночью по МСК toISOString() отдаёт вчерашний день,
  // а от этой даты считается граница начислений.
  const todayIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)

  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [directions, setDirections] = useState<DirectionOption[]>([])

  // Период берём из ссылки (/salary передаёт выбранный месяц: ?year&month);
  // без параметров — предыдущий месяц (типовой сценарий «платим за прошлый»).
  const qYear = Number(searchParams.get("year"))
  const qMonth = Number(searchParams.get("month"))
  const [periodYear, setPeriodYear] = useState(
    Number.isInteger(qYear) && qYear >= 2020 && qYear <= 2099
      ? qYear
      : now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  )
  const [periodMonth, setPeriodMonth] = useState(
    Number.isInteger(qMonth) && qMonth >= 1 && qMonth <= 12
      ? qMonth
      : now.getMonth() === 0 ? 12 : now.getMonth()
  )
  const kind = searchParams.get("kind") === "salary" ? "salary" : "piece"
  const periodMonthStr = `${periodYear}-${String(periodMonth).padStart(2, "0")}`
  const [opiu, setOpiu] = useState<OpiuRecognitionState>({
    recognitionMode: "single_period", singleMonth: periodMonthStr, amortStartMonth: periodMonthStr, amortMonths: "3",
  })
  const [date, setDate] = useState(todayIso)
  const [comment, setComment] = useState("")

  // Граница начислений (аванс «по 15-е»): занятия учитываются по эту дату
  // включительно. По умолчанию следует за датой выплаты, пока она внутри
  // месяца периода (иначе — конец месяца), до первого ручного изменения.
  const [accrualUpTo, setAccrualUpTo] = useState("")
  const [upToTouched, setUpToTouched] = useState(false)
  useEffect(() => { setUpToTouched(false) }, [periodYear, periodMonth])
  useEffect(() => {
    if (upToTouched) return
    const prefix = `${periodYear}-${String(periodMonth).padStart(2, "0")}-`
    setAccrualUpTo(date.startsWith(prefix) ? date : monthLastDayIso(periodYear, periodMonth))
  }, [date, periodYear, periodMonth, upToTouched])

  const [accruals, setAccruals] = useState<AccrualRow[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [defaultAccountId, setDefaultAccountId] = useState("")

  const [loadingAccruals, setLoadingAccruals] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Загрузка справочников.
  useEffect(() => {
    fetch("/api/accounts").then(r => r.ok ? r.json() : []).then((data: any) => {
      const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []
      setAccounts(list.map((a: any) => ({ id: a.id, name: a.name })))
    }).catch(() => { /* ignore */ })
    fetch("/api/directions").then(r => r.ok ? r.json() : []).then((data: any) => {
      const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []
      setDirections(list.map((d: any) => ({ id: d.id, name: d.name })))
    }).catch(() => { /* ignore */ })
  }, [])

  const loadAccruals = useCallback(async () => {
    setLoadingAccruals(true)
    setError(null)
    try {
      const upToParam = accrualUpTo ? `&upTo=${accrualUpTo}` : ""
      // Скоупим начисления под тип документа: сдельный документ не должен
      // подтягивать оклад (иначе оклад дублируется строкой «Без направления» и
      // выплачивается второй раз — уже начислен отдельным оклад-документом →
      // двойной счёт в ОПИУ). Endpoint по kind отдаёт только нужный источник.
      const res = await fetch(`/api/salary-payments/accruals?periodYear=${periodYear}&periodMonth=${periodMonth}&kind=${kind}${upToParam}`)
      if (!res.ok) {
        setError("Не удалось загрузить начисления")
        return
      }
      const json = await res.json()
      const data: AccrualRow[] = json.data || []
      setAccruals(data)
      // «К выплате» = остаток (начислено − уже выплачено за период), а не полное
      // начисление: повторное заполнение после аванса не даёт переплату.
      // Построчные остатки отсекаются по нулю, поэтому отрицательные компоненты
      // (штраф больше премии, переплата по направлению, аванс строкой «без
      // направления») в них теряются — сумма строк ограничивается «бюджетом»:
      // общим остатком сотрудника за период (Σ строк ≤ max(0, row.remaining)).
      const newItems: ItemRow[] = []
      for (const row of data) {
        let budget = Math.max(0, row.remaining)
        for (const d of row.byDirection) {
          if (d.remaining <= 0 || budget <= 0) continue
          const give = r2(Math.min(d.remaining, budget))
          if (give <= 0) continue
          budget = r2(budget - give)
          newItems.push({
            uid: uid(),
            employeeId: row.employeeId,
            employeeName: row.employeeName,
            directionId: d.directionId,
            directionName: d.directionName,
            accruedHint: d.amount,
            paidHint: d.paid,
            remainingHint: d.remaining,
            amount: String(give),
            accountId: defaultAccountId,
            comment: "",
          })
        }
        // Премии − штрафы за период (за вычетом выплат «без направления»).
        if (row.adjRemaining > 0 && budget > 0) {
          const give = r2(Math.min(row.adjRemaining, budget))
          if (give > 0) {
            newItems.push({
              uid: uid(),
              employeeId: row.employeeId,
              employeeName: row.employeeName,
              directionId: null,
              directionName: "Без направления",
              accruedHint: row.adjNet,
              paidHint: row.adjPaid,
              remainingHint: row.adjRemaining,
              amount: String(give),
              accountId: defaultAccountId,
              comment: "Премии − штрафы",
            })
          }
        }
      }
      setItems(newItems)
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoadingAccruals(false)
    }
  }, [periodYear, periodMonth, accrualUpTo, defaultAccountId, kind])

  // Граница начислений внутри месяца периода = режим аванса.
  const periodPrefix = `${periodYear}-${String(periodMonth).padStart(2, "0")}-`
  const isPartialCutoff =
    accrualUpTo.startsWith(periodPrefix) && accrualUpTo < monthLastDayIso(periodYear, periodMonth)

  function updateItem(uid: string, patch: Partial<ItemRow>) {
    setItems(prev => prev.map(it => it.uid === uid ? { ...it, ...patch } : it))
  }

  function removeItem(uid: string) {
    setItems(prev => prev.filter(it => it.uid !== uid))
  }

  function addEmptyRow(employeeId: string, employeeName: string) {
    setItems(prev => [
      ...prev,
      {
        uid: uid(),
        employeeId,
        employeeName,
        directionId: null,
        directionName: "Без направления",
        accruedHint: 0,
        paidHint: 0,
        remainingHint: null,
        amount: "",
        accountId: defaultAccountId,
        comment: "",
      },
    ])
  }

  function applyDefaultAccount() {
    setItems(prev => prev.map(it => it.accountId ? it : { ...it, accountId: defaultAccountId }))
  }

  async function handleSubmit() {
    setError(null)
    setSuccess(null)
    if (items.length === 0) {
      setError("Добавьте хотя бы одну строку (нажмите «Заполнить» или «+ Строка»)")
      return
    }
    for (const it of items) {
      if (!it.accountId) { setError(`Выберите счёт для строки «${it.employeeName} — ${it.directionName}»`); return }
      const n = Number(it.amount)
      if (!Number.isFinite(n) || n <= 0) { setError(`Укажите сумму для строки «${it.employeeName} — ${it.directionName}»`); return }
    }

    let recognition: RecognitionPayload = { recognitionMode: "by_payment_date", amortizationStartDate: undefined, amortizationMonths: undefined }
    if (kind === "salary") {
      try { recognition = resolveRecognition(opiu) } catch (err) { setError(err instanceof Error ? err.message : "Ошибка признания"); return }
    }

    setSaving(true)
    try {
      const res = await fetch("/api/salary-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          date,
          periodYear,
          periodMonth,
          // Отчёт «ЗП по инструкторам» делит выплаты по половинам месяца:
          // periodHalf=1 — первая половина (аванс), иначе — вторая.
          periodHalf: isPartialCutoff && Number(accrualUpTo.slice(8, 10)) <= 15 ? 1 : 2,
          comment: comment || undefined,
          items: items.map(it => ({
            employeeId: it.employeeId,
            accountId: it.accountId,
            directionId: it.directionId,
            amount: Number(it.amount),
            comment: it.comment || undefined,
          })),
          recognitionMode: recognition.recognitionMode,
          amortizationStartDate: recognition.amortizationStartDate,
          amortizationMonths: recognition.amortizationMonths,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при сохранении")
        return
      }
      setSuccess("Документ выплаты сохранён")
      setTimeout(() => router.push(`/salary?year=${periodYear}&month=${periodMonth}`), 600)
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  // Итоги.
  const totalByAccount = new Map<string, number>()
  const totalByEmployee = new Map<string, number>()
  const totalByDirection = new Map<string, number>()
  let totalAmount = 0
  for (const it of items) {
    const amt = Number(it.amount) || 0
    if (amt <= 0) continue
    totalAmount += amt
    if (it.accountId) totalByAccount.set(it.accountId, (totalByAccount.get(it.accountId) || 0) + amt)
    totalByEmployee.set(it.employeeName, (totalByEmployee.get(it.employeeName) || 0) + amt)
    const dirKey = it.directionName
    totalByDirection.set(dirKey, (totalByDirection.get(dirKey) || 0) + amt)
  }

  // Уникальные сотрудники для добавления новых строк.
  const employeesInDoc = Array.from(new Map(items.map(it => [it.employeeId, it.employeeName])).entries())

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/salary" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Документ выплаты ЗП{kind === "salary" ? " (оклады)" : " (сдельная)"}</h1>
            <PageHelp pageKey="salary/payments/new" />
          </div>
          <p className="text-sm text-muted-foreground">
            Кнопка «Заполнить» подтягивает остатки к выплате под тип документа: {kind === "salary" ? "оклады" : "сдельную оплату за занятия по направлениям"} + премии, за вычетом уже выплаченного за период. Начисления считаются по дату из поля «Начисления по дату».
          </p>
        </div>
      </div>

      {/* Шапка документа */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Период и параметры</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Год периода *</Label>
            <Input type="number" min="2020" max="2099" value={periodYear} onChange={e => setPeriodYear(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Месяц периода *</Label>
            <Select value={String(periodMonth)} onValueChange={(v) => { if (v) setPeriodMonth(Number(v)) }}>
              <SelectTrigger className="w-full">{MONTH_NAMES[periodMonth - 1]}</SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((name, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Дата выплаты *</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Начисления по дату</Label>
            <Input
              type="date"
              value={accrualUpTo}
              onChange={e => { setUpToTouched(true); setAccrualUpTo(e.target.value) }}
            />
            {isPartialCutoff ? (
              <p className="text-xs text-orange-600">
                Аванс: начисления по {accrualUpTo.split("-").reverse().join(".")} включительно. Оклады — пропорционально дням, премии не включаются.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Полный месяц. Для аванса поставьте, например, 15-е — начисления посчитаются по эту дату включительно.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Комментарий</Label>
            <Input value={comment} onChange={e => setComment(e.target.value)} placeholder="Например: основная выплата за {месяц}" />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Счёт по умолчанию (для новых строк)</Label>
            <div className="flex gap-2">
              <Select value={defaultAccountId} onValueChange={(v) => { if (v !== null) setDefaultAccountId(v) }}>
                <SelectTrigger className="w-full">
                  {accounts.find(a => a.id === defaultAccountId)?.name ?? "Не выбран"}
                </SelectTrigger>
                <SelectContent>
                  {accounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" onClick={applyDefaultAccount} disabled={!defaultAccountId || items.length === 0}>
                Применить к пустым
              </Button>
            </div>
          </div>

          <div className="space-y-1.5 sm:col-span-2 flex flex-col justify-end">
            <Button type="button" onClick={loadAccruals} disabled={loadingAccruals}>
              <Sparkles className="mr-2 size-4" />
              {loadingAccruals ? "Загрузка..." : "Заполнить начисления"}
            </Button>
            {accruals.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Загружено {accruals.length} сотрудников. К выплате можно править суммы и разбивать по нескольким счетам.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      {success && (
        <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{success}</div>
      )}

      {/* Таблица items */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Строки выплат
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({items.length} {items.length === 1 ? "строка" : "строк"})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
              <p className="text-sm">Нажмите «Заполнить начисления», чтобы подтянуть данные.</p>
            </div>
          ) : (
            <StickyHScroll>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Сотрудник</TableHead>
                    <TableHead>Направление</TableHead>
                    <TableHead className="text-right">Начислено</TableHead>
                    <TableHead className="text-right">Выплачено</TableHead>
                    <TableHead className="text-right">К выплате</TableHead>
                    <TableHead>Счёт</TableHead>
                    <TableHead>Комментарий</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(it => (
                    <TableRow key={it.uid}>
                      <TableCell className="font-medium">{it.employeeName}</TableCell>
                      <TableCell>
                        <Select value={it.directionId ?? "__none__"} onValueChange={(v) => {
                          if (v === "__none__") {
                            updateItem(it.uid, { directionId: null, directionName: "Без направления" })
                          } else {
                            const d = directions.find(x => x.id === v)
                            if (d) updateItem(it.uid, { directionId: d.id, directionName: d.name })
                          }
                        }}>
                          <SelectTrigger className="w-full min-w-[160px]">{it.directionName}</SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Без направления</SelectItem>
                            {directions.map(d => (
                              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {it.accruedHint > 0 ? formatMoney(it.accruedHint) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {it.paidHint > 0 ? formatMoney(it.paidHint) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={it.amount}
                          onChange={e => updateItem(it.uid, { amount: e.target.value })}
                          className={
                            "w-[120px] text-right" +
                            (isOverpaid(it) ? " border-orange-400 text-orange-700" : "")
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Select value={it.accountId} onValueChange={(v) => { if (v) updateItem(it.uid, { accountId: v }) }}>
                          <SelectTrigger className="w-full min-w-[140px]">
                            {accounts.find(a => a.id === it.accountId)?.name ?? "—"}
                          </SelectTrigger>
                          <SelectContent>
                            {accounts.map(a => (
                              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input value={it.comment} onChange={e => updateItem(it.uid, { comment: e.target.value })} placeholder="" />
                      </TableCell>
                      <TableCell>
                        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => removeItem(it.uid)}>
                          <Trash2 className="size-4 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </StickyHScroll>
          )}

          {items.some(isOverpaid) && (
            <div className="border-t px-4 py-2 text-xs text-orange-600">
              Внимание: по подсвеченным строкам сумма больше остатка за период — будет переплата.
            </div>
          )}

          {/* Добавить ещё строку */}
          {employeesInDoc.length > 0 && (
            <div className="border-t p-3">
              <p className="mb-2 text-xs text-muted-foreground">Добавить ещё строку для сотрудника:</p>
              <div className="flex flex-wrap gap-2">
                {employeesInDoc.map(([empId, empName]) => (
                  <Button key={empId} type="button" variant="outline" size="sm" onClick={() => addEmptyRow(empId, empName)}>
                    <Plus className="mr-1 size-3" />
                    {empName}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Итоги */}
      {items.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Итого по счетам</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {totalByAccount.size === 0 ? (
                <p className="text-muted-foreground">—</p>
              ) : (
                Array.from(totalByAccount.entries()).map(([accId, sum]) => (
                  <div key={accId} className="flex justify-between">
                    <span>{accounts.find(a => a.id === accId)?.name ?? "—"}</span>
                    <span className="font-medium">{formatMoney(sum)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Итого по сотрудникам</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {Array.from(totalByEmployee.entries()).map(([name, sum]) => (
                <div key={name} className="flex justify-between">
                  <span>{name}</span>
                  <span className="font-medium">{formatMoney(sum)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Итого по направлениям (для ОПИУ)</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {Array.from(totalByDirection.entries()).map(([name, sum]) => (
                <div key={name} className="flex justify-between">
                  <span>{name}</span>
                  <span className="font-medium">{formatMoney(sum)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {kind === "salary" && items.length > 0 && (
        <OpiuRecognitionFieldset value={opiu} onChange={setOpiu} amount={totalAmount} sym={currencySym} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-y-3 rounded-md border bg-muted/30 px-4 py-3">
        <div>
          <span className="text-sm text-muted-foreground">Итого к выплате:</span>
          <span className="ml-2 text-xl font-bold">{formatMoney(totalAmount)}</span>
          <Badge variant="outline" className="ml-3">
            {MONTH_NAMES[periodMonth - 1]} {periodYear}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Link href="/salary">
            <Button variant="outline">Отмена</Button>
          </Link>
          <Button onClick={handleSubmit} disabled={saving || items.length === 0}>
            {saving ? "Сохранение..." : "Провести выплату"}
          </Button>
        </div>
      </div>
    </div>
  )
}
