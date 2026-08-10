"use client"

import { Fragment } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { StickyHScroll } from "@/components/sticky-h-scroll"
import { ReportShell, ReportStatus, useReportData, useReportObject } from "@/components/report-scaffold"

interface Row {
  campaignId: string
  campaignName: string
  status: string
  createdAt: string
  total: number
  processed: number
  applications: number
  trialScheduled: number
  sales: number
  noAnswer: number
  refused: number
  processedRate: number
  applicationConversion: number
  trialConversion: number
  saleConversion: number
}

/** Ячейка «менеджер × день»: всего обзвонено и разбивка по исходам. */
interface DayCell {
  total: number
  application: number
  completed: number
  callback: number
  noAnswer: number
}

interface ManagerRow {
  employeeId: string
  name: string
  byDay: Record<string, DayCell>
  totals: DayCell
}

interface ManagerReport {
  days: string[]
  managers: ManagerRow[]
}

export default function CallEfficiencyReportPage() {
  return (
    <ReportShell
      title="Эффективность обзвонов"
      subtitle="Результативность обзвонных кампаний за месяц"
      pageKey="reports/crm/call-efficiency"
    >
      <Tabs defaultValue="by-campaign">
        <TabsList className="grid w-full max-w-xl grid-cols-3">
          <TabsTrigger value="by-campaign">По кампаниям</TabsTrigger>
          <TabsTrigger value="by-manager">По менеджерам</TabsTrigger>
          <TabsTrigger value="by-day">По дням</TabsTrigger>
        </TabsList>

        <TabsContent value="by-campaign" className="space-y-4">
          <ByCampaignTab />
        </TabsContent>

        <TabsContent value="by-manager" className="space-y-4">
          <ByManagerTab />
        </TabsContent>

        <TabsContent value="by-day" className="space-y-4">
          <ByDayTab />
        </TabsContent>
      </Tabs>
    </ReportShell>
  )
}

/** Вкладка 1 — сводка по кампаниям (кампании отбираются по дате создания в месяце). */
function ByCampaignTab() {
  const { loading, error, data } = useReportData<Row>("/api/reports/call-efficiency")

  return (
    <Card>
      <CardContent className="p-0">
        <ReportStatus
          loading={loading}
          error={error}
          empty={data.length === 0}
          emptyText="За месяц обзвонных кампаний нет"
        />
        {!loading && !error && data.length > 0 && (
          <StickyHScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Кампания</TableHead>
                  <TableHead className="text-right">Всего</TableHead>
                  <TableHead className="text-right">Отработано</TableHead>
                  <TableHead className="text-right">% отработки</TableHead>
                  <TableHead className="text-right">Заявки</TableHead>
                  <TableHead className="text-right">Конв. в заявку</TableHead>
                  <TableHead className="text-right">Пробные</TableHead>
                  <TableHead className="text-right">Конв. в пробное</TableHead>
                  <TableHead className="text-right">Продажи</TableHead>
                  <TableHead className="text-right">Конв. в продажу</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.campaignId}>
                    <TableCell className="font-medium">{r.campaignName}</TableCell>
                    <TableCell className="text-right">{r.total}</TableCell>
                    <TableCell className="text-right">{r.processed}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.processedRate}%</TableCell>
                    <TableCell className="text-right font-medium text-amber-600">{r.applications}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.applicationConversion}%</TableCell>
                    <TableCell className="text-right">{r.trialScheduled}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.trialConversion}%</TableCell>
                    <TableCell className="text-right font-medium text-blue-600">{r.sales}</TableCell>
                    <TableCell className="text-right font-bold">{r.saleConversion}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </StickyHScroll>
        )}
      </CardContent>
    </Card>
  )
}

// Исходы-подстроки под каждым менеджером (порядок = как в карточке кампании).
const STATUS_ROWS: { key: keyof DayCell; label: string; color: string }[] = [
  { key: "application", label: "Создано заявок", color: "text-amber-600" },
  { key: "completed", label: "Отказ", color: "text-rose-600" },
  { key: "callback", label: "Перезвонить", color: "text-violet-600" },
  { key: "noAnswer", label: "Не ответил", color: "text-slate-600" },
]

/** Заголовок дневного столбца: «12» + короткий день недели. Полдень — чтобы TZ не сдвигал день. */
function dayHeader(iso: string): { d: string; wd: string } {
  const dt = new Date(`${iso}T12:00:00`)
  return { d: iso.slice(8, 10), wd: dt.toLocaleDateString("ru-RU", { weekday: "short" }) }
}

/** 0/undefined показываем пусто — чтобы матрица не рябила нулями. */
function cellVal(n: number | undefined): string {
  return n ? String(n) : ""
}

function emptyCell(): DayCell {
  return { total: 0, application: 0, completed: 0, callback: 0, noAnswer: 0 }
}

/**
 * Вкладка 2 — по менеджерам: строки = менеджеры (кто фиксировал результат),
 * столбцы = дни месяца (по МСК). Под каждым менеджером строка «Всего обзвонено»
 * (за день) и разбивка по исходам результата.
 */
function ByManagerTab() {
  const { loading, error, data } = useReportObject<ManagerReport>(
    "/api/reports/call-efficiency/by-manager",
  )

  const days = data?.days ?? []
  const managers = data?.managers ?? []

  return (
    <Card>
      <CardContent className="p-0">
        <ReportStatus
          loading={loading}
          error={error}
          empty={!loading && !error && managers.length === 0}
          emptyText="За месяц зафиксированных звонков нет"
        />
        {!loading && !error && managers.length > 0 && (
          <StickyHScroll>
            <Table className="min-w-max">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky left-0 z-20 min-w-[170px] bg-card">
                    Менеджер / исход
                  </TableHead>
                  {days.map((d) => {
                    const h = dayHeader(d)
                    return (
                      <TableHead key={d} className="min-w-[44px] px-2 text-center">
                        <div className="font-semibold text-foreground">{h.d}</div>
                        <div className="text-[10px] font-normal text-muted-foreground">{h.wd}</div>
                      </TableHead>
                    )
                  })}
                  <TableHead className="min-w-[56px] px-2 text-center">Итого</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {managers.map((m) => (
                  <Fragment key={m.employeeId}>
                    {/* Шапка менеджера = «Всего обзвонено» по дням */}
                    <TableRow className="bg-muted font-semibold hover:bg-muted">
                      <TableCell className="sticky left-0 z-10 bg-muted">{m.name}</TableCell>
                      {days.map((d) => (
                        <TableCell key={d} className="px-2 text-center">
                          {cellVal(m.byDay[d]?.total)}
                        </TableCell>
                      ))}
                      <TableCell className="px-2 text-center">{m.totals.total}</TableCell>
                    </TableRow>
                    {/* Разбивка по исходам */}
                    {STATUS_ROWS.map((sr) => (
                      <TableRow key={sr.key} className="hover:bg-transparent">
                        <TableCell
                          className={`sticky left-0 z-10 bg-card pl-8 text-xs ${sr.color}`}
                        >
                          {sr.label}
                        </TableCell>
                        {days.map((d) => (
                          <TableCell key={d} className="px-2 text-center text-xs text-muted-foreground">
                            {cellVal(m.byDay[d]?.[sr.key])}
                          </TableCell>
                        ))}
                        <TableCell className="px-2 text-center text-xs font-medium">
                          {m.totals[sr.key] || ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </StickyHScroll>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Вкладка 3 — по дням: та же матрица, что «по менеджерам», но суммарно по всем
 * менеджерам. Строки — исходы (Всего обзвонено + разбивка), столбцы — дни месяца
 * (по МСК). Данные берём из того же эндпоинта by-manager и агрегируем по дням.
 */
function ByDayTab() {
  const { loading, error, data } = useReportObject<ManagerReport>(
    "/api/reports/call-efficiency/by-manager",
  )

  const days = data?.days ?? []
  const managers = data?.managers ?? []

  // Сумма по всем менеджерам: день → ячейка, плюс итог за месяц.
  const byDay: Record<string, DayCell> = {}
  const totals = emptyCell()
  for (const m of managers) {
    for (const day of days) {
      const c = m.byDay[day]
      if (!c) continue
      const agg = (byDay[day] ??= emptyCell())
      agg.total += c.total
      agg.application += c.application
      agg.completed += c.completed
      agg.callback += c.callback
      agg.noAnswer += c.noAnswer
    }
    totals.total += m.totals.total
    totals.application += m.totals.application
    totals.completed += m.totals.completed
    totals.callback += m.totals.callback
    totals.noAnswer += m.totals.noAnswer
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ReportStatus
          loading={loading}
          error={error}
          empty={!loading && !error && managers.length === 0}
          emptyText="За месяц зафиксированных звонков нет"
        />
        {!loading && !error && managers.length > 0 && (
          <StickyHScroll>
            <Table className="min-w-max">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky left-0 z-20 min-w-[170px] bg-card">Исход / день</TableHead>
                  {days.map((d) => {
                    const h = dayHeader(d)
                    return (
                      <TableHead key={d} className="min-w-[44px] px-2 text-center">
                        <div className="font-semibold text-foreground">{h.d}</div>
                        <div className="text-[10px] font-normal text-muted-foreground">{h.wd}</div>
                      </TableHead>
                    )
                  })}
                  <TableHead className="min-w-[56px] px-2 text-center">Итого</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Всего обзвонено за день */}
                <TableRow className="bg-muted font-semibold hover:bg-muted">
                  <TableCell className="sticky left-0 z-10 bg-muted">Всего обзвонено</TableCell>
                  {days.map((d) => (
                    <TableCell key={d} className="px-2 text-center">
                      {cellVal(byDay[d]?.total)}
                    </TableCell>
                  ))}
                  <TableCell className="px-2 text-center">{totals.total}</TableCell>
                </TableRow>
                {/* Разбивка по исходам */}
                {STATUS_ROWS.map((sr) => (
                  <TableRow key={sr.key} className="hover:bg-transparent">
                    <TableCell className={`sticky left-0 z-10 bg-card pl-8 text-xs ${sr.color}`}>
                      {sr.label}
                    </TableCell>
                    {days.map((d) => (
                      <TableCell key={d} className="px-2 text-center text-xs text-muted-foreground">
                        {cellVal(byDay[d]?.[sr.key])}
                      </TableCell>
                    ))}
                    <TableCell className="px-2 text-center text-xs font-medium">
                      {totals[sr.key] || ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </StickyHScroll>
        )}
      </CardContent>
    </Card>
  )
}
