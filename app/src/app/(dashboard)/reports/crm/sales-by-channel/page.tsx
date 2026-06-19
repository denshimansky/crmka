"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData } from "@/components/report-scaffold"

interface Row {
  managerId: string
  managerName: string
  total: number
  byChannel: Record<string, number>
}

interface ChannelCol {
  id: string
  name: string
}

const MODES = [
  { value: "sales", label: "Продажи" },
  { value: "trials_scheduled", label: "Назначенные пробные" },
  { value: "trials_attended", label: "Посещённые пробные" },
] as const

export default function SalesByChannelReportPage() {
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("sales")
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/sales-by-channel", { mode })
  const channels = (metadata?.channels ?? []) as ChannelCol[]

  const rows = data.slice().sort((a, b) => b.total - a.total)

  // Итоги по каналам и общий итог.
  const colTotals: Record<string, number> = {}
  let grandTotal = 0
  for (const r of data) {
    grandTotal += r.total
    for (const ch of channels) colTotals[ch.id] = (colTotals[ch.id] || 0) + (r.byChannel[ch.id] || 0)
  }

  const toggle = (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Показатель:</span>
      {MODES.map((m) => (
        <button key={m.value} onClick={() => setMode(m.value)}>
          <Badge variant={mode === m.value ? "default" : "outline"}>{m.label}</Badge>
        </button>
      ))}
    </div>
  )

  return (
    <ReportShell
      title="Продажи менеджеров по каналам"
      subtitle="Менеджеры × каналы привлечения за месяц (переключатель показателя)"
      pageKey="reports/crm/sales-by-channel"
      actions={toggle}
    >
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Менеджер</TableHead>
                  {channels.map((ch) => (
                    <TableHead key={ch.id} className="text-right whitespace-nowrap">
                      {ch.name}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Всего</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.managerId}>
                    <TableCell className="font-medium whitespace-nowrap">{r.managerName}</TableCell>
                    {channels.map((ch) => {
                      const v = r.byChannel[ch.id] || 0
                      return (
                        <TableCell key={ch.id} className="text-right tabular-nums">
                          {v > 0 ? v : <span className="text-muted-foreground">0</span>}
                        </TableCell>
                      )
                    })}
                    <TableCell className="text-right font-medium tabular-nums">{r.total}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell>Итого</TableCell>
                  {channels.map((ch) => (
                    <TableCell key={ch.id} className="text-right tabular-nums">
                      {colTotals[ch.id] || 0}
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">{grandTotal}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  )
}
