"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData } from "@/components/report-scaffold"
import { useRoleNames } from "@/components/role-names-provider"

interface Row {
  instructorId?: string
  instructorName?: string
  branchId?: string
  branchName?: string
  activeSubscriptions: number
  churned: number
  churnRate: number
}

export default function ChurnByInstructorReportPage() {
  const roleNames = useRoleNames()
  const [groupBy, setGroupBy] = useState<"instructor" | "branch">("instructor")
  const { loading, error, data } = useReportData<Row>("/api/reports/churn-by-instructors", { groupBy })

  const toggle = (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Разрез:</span>
      <button onClick={() => setGroupBy("instructor")}>
        <Badge variant={groupBy === "instructor" ? "default" : "outline"}>Инструкторы</Badge>
      </button>
      <button onClick={() => setGroupBy("branch")}>
        <Badge variant={groupBy === "branch" ? "default" : "outline"}>Филиалы</Badge>
      </button>
    </div>
  )

  return (
    <ReportShell
      title="Конверсия оттока по инструкторам"
      subtitle="% оттока = выбывшие / активные абонементы за месяц"
      pageKey="reports/churn/by-instructor"
      actions={toggle}
    >
      <Card className="w-fit max-w-full">
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table className="w-auto">
              <TableHeader>
                <TableRow>
                  <TableHead>{groupBy === "instructor" ? roleNames.instructor : "Филиал"}</TableHead>
                  <TableHead className="text-right">Активные абонементы</TableHead>
                  <TableHead className="text-right">Отток</TableHead>
                  <TableHead className="text-right">% оттока</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.instructorId || r.branchId}>
                    <TableCell className="font-medium">{r.instructorName || r.branchName || "—"}</TableCell>
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
