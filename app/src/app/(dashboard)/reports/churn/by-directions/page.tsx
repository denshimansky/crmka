"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData } from "@/components/report-scaffold"

interface Row {
  name: string
  activeSubscriptions: number
  churned: number
  churnRate: number
  completedCourse: number
}

export default function ChurnByDirectionsReportPage() {
  const [groupBy, setGroupBy] = useState<"direction" | "branch">("direction")
  const { loading, error, data } = useReportData<Row>("/api/reports/churn-by-directions", { groupBy })

  const toggle = (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Разрез:</span>
      <button onClick={() => setGroupBy("direction")}>
        <Badge variant={groupBy === "direction" ? "default" : "outline"}>Направления</Badge>
      </button>
      <button onClick={() => setGroupBy("branch")}>
        <Badge variant={groupBy === "branch" ? "default" : "outline"}>Филиалы</Badge>
      </button>
    </div>
  )

  return (
    <ReportShell
      title="Отток по направлениям и филиалам"
      subtitle="Активные абонементы прошлого месяца, не продлённые в текущем"
      pageKey="reports/churn/by-directions"
      actions={toggle}
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{groupBy === "direction" ? "Направление" : "Филиал"}</TableHead>
                  <TableHead className="text-right">Активные абонементы</TableHead>
                  <TableHead className="text-right">Отток</TableHead>
                  <TableHead className="text-right">% оттока</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right">{r.activeSubscriptions}</TableCell>
                    <TableCell className="text-right text-red-600">{r.churned}</TableCell>
                    <TableCell className="text-right font-bold">{r.churnRate}%</TableCell>
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
