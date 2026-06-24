"use client"

import { useEffect, useState, useCallback, Fragment } from "react"
import Link from "next/link"
import { ArrowLeft, ChevronRight, ChevronDown } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PayByDirectionDialog } from "./pay-by-direction-dialog"
import { PageHelp } from "@/components/page-help"
import { ReportExport } from "@/components/report-export"

interface DirectionDetail {
  directionId: string | null
  directionName: string
  accrued: number
  accruedFirstHalf: number
  paid: number
  remaining: number
  lessonCount: number
}
interface LessonDetail {
  lessonId: string
  date: string
  groupName: string
  directionId: string | null
  directionName: string
  typeName: string
  studentsCharged: number
  amount: number
}
export interface InstructorDetailData {
  employee: { id: string; name: string; role: string }
  periodYear: number
  periodMonth: number
  canPay: boolean
  periodLocked: boolean
  accounts: { id: string; name: string }[]
  byDirection: DirectionDetail[]
  adjustments: { bonuses: number; penalties: number; net: number; paidNoDirection: number; remaining: number }
  lessons: LessonDetail[]
  totals: { accrued: number; accruedFirstHalf: number; bonuses: number; penalties: number; paid: number; remaining: number }
}

const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n * 100) / 100) + " ₽"

export function InstructorDetailClient({ employeeId, year, month }: { employeeId: string; year: number; month: number }) {
  const [data, setData] = useState<InstructorDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/salary/instructor/${employeeId}?periodYear=${year}&periodMonth=${month}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Ошибка загрузки")
        return
      }
      setData(await res.json())
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }, [employeeId, year, month])

  useEffect(() => { load() }, [load])

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  if (loading) return <p className="text-sm text-muted-foreground">Загрузка…</p>
  if (error) return <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
  if (!data) return null

  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
  const monthKey = `${year}-${String(month).padStart(2, "0")}`

  // Расшифровка по занятиям для выгрузки в Excel: одна строка на занятие
  // (направление/дата/группа/тип/ученики/начислено), затем премии−штрафы и Итого.
  const hasExport = data.lessons.length > 0 || data.adjustments.net !== 0
  const exportRows: Record<string, string | number>[] = [
    ...[...data.lessons]
      .sort((a, b) => a.directionName.localeCompare(b.directionName, "ru") || a.date.localeCompare(b.date))
      .map((l) => ({
        direction: l.directionName,
        date: new Date(l.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }),
        group: l.groupName,
        type: l.typeName,
        students: l.studentsCharged,
        amount: Math.round(l.amount),
      })),
    ...(data.adjustments.net !== 0
      ? [{ direction: "Премии − штрафы (без направления)", date: "", group: "", type: "", students: "", amount: Math.round(data.adjustments.net) }]
      : []),
    { direction: "Итого", date: "", group: "", type: "", students: "", amount: Math.round(data.totals.accrued) },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={`/salary?year=${year}&month=${month}`} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{data.employee.name}</h1>
              <PageHelp pageKey="salary/instructor" />
            </div>
            <p className="text-sm text-muted-foreground">Детализация ЗП — {monthName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasExport && (
            <ReportExport
              title={`Детализация ЗП — ${data.employee.name}`}
              filename={`salary-${data.employee.name.replace(/\s+/g, "_")}-${monthKey}`}
              sheetName="Детализация ЗП"
              period={monthName}
              columns={[
                { header: "Направление", key: "direction", width: 22 },
                { header: "Дата", key: "date", width: 12 },
                { header: "Группа", key: "group", width: 26 },
                { header: "Тип", key: "type", width: 14 },
                { header: "Учеников", key: "students", width: 10 },
                { header: "Начислено, ₽", key: "amount", width: 14 },
              ]}
              rows={exportRows}
            />
          )}
          {data.canPay && (
            <>
              <PayByDirectionDialog mode="advance" data={data} onPaid={load} />
              <PayByDirectionDialog mode="remainder" data={data} onPaid={load} />
            </>
          )}
        </div>
      </div>

      {data.periodLocked && (
        <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-200">
          Период закрыт — выплаты недоступны.
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Направление</TableHead>
                <TableHead className="text-right">Начислено</TableHead>
                <TableHead className="text-right">до 15-го (аванс)</TableHead>
                <TableHead className="text-right">Выплачено</TableHead>
                <TableHead className="text-right">Остаток</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byDirection.length === 0 && data.adjustments.net === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Нет начислений за период</TableCell></TableRow>
              )}
              {data.byDirection.map((d) => {
                const key = d.directionId ?? "__no_direction__"
                const isOpen = expanded.has(key)
                const dirLessons = data.lessons.filter((l) => (l.directionId ?? "__no_direction__") === key)
                return (
                  <Fragment key={key}>
                    <TableRow className="cursor-pointer" onClick={() => toggle(key)}>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1">
                          {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          {d.directionName}
                          <span className="text-xs text-muted-foreground">({d.lessonCount} зан.)</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{fmt(d.accrued)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmt(d.accruedFirstHalf)}</TableCell>
                      <TableCell className="text-right text-purple-600">{d.paid > 0 ? fmt(d.paid) : "—"}</TableCell>
                      <TableCell className={`text-right font-medium ${d.remaining > 0 ? "text-orange-600" : ""}`}>{fmt(d.remaining)}</TableCell>
                    </TableRow>
                    {isOpen && dirLessons.map((l) => (
                      <TableRow key={l.lessonId} className="bg-muted/30 text-sm">
                        <TableCell className="pl-9 text-muted-foreground" colSpan={4}>
                          {new Date(l.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "UTC" })} · {l.groupName} · {l.typeName} · {l.studentsCharged} уч.
                        </TableCell>
                        <TableCell className="text-right">{fmt(l.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                )
              })}
              {data.adjustments.net !== 0 && (
                <TableRow>
                  <TableCell className="font-medium">Премии − штрафы <span className="text-xs text-muted-foreground">(без направления)</span></TableCell>
                  <TableCell className="text-right">{fmt(data.adjustments.net)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">—</TableCell>
                  <TableCell className="text-right text-purple-600">{data.adjustments.paidNoDirection > 0 ? fmt(data.adjustments.paidNoDirection) : "—"}</TableCell>
                  <TableCell className={`text-right font-medium ${data.adjustments.remaining > 0 ? "text-orange-600" : ""}`}>{fmt(data.adjustments.remaining)}</TableCell>
                </TableRow>
              )}
              <TableRow className="font-bold">
                <TableCell>Итого</TableCell>
                <TableCell className="text-right">{fmt(data.totals.accrued)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{fmt(data.totals.accruedFirstHalf)}</TableCell>
                <TableCell className="text-right text-purple-600">{data.totals.paid > 0 ? fmt(data.totals.paid) : "—"}</TableCell>
                <TableCell className="text-right">{fmt(data.totals.remaining)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
