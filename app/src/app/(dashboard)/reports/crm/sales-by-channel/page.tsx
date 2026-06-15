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

const MODES = [
  { value: "sales", label: "Продажи" },
  { value: "trials_scheduled", label: "Назначенные пробные" },
  { value: "trials_attended", label: "Посещённые пробные" },
] as const

export default function SalesByChannelReportPage() {
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("sales")
  const { loading, error, data } = useReportData<Row>("/api/reports/sales-by-channel", { mode })

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
      subtitle="Назначенные/посещённые пробные и продажи в разрезе менеджеров за месяц"
      pageKey="reports/crm/sales-by-channel"
      actions={toggle}
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Менеджер</TableHead>
                  <TableHead className="text-right">{MODES.find((m) => m.value === mode)?.label}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data
                  .slice()
                  .sort((a, b) => b.total - a.total)
                  .map((r) => (
                    <TableRow key={r.managerId}>
                      <TableCell className="font-medium">{r.managerName}</TableCell>
                      <TableCell className="text-right font-medium">{r.total}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  )
}
