"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Check, X } from "lucide-react"
import { ReportShell, ReportStatus, useReportData } from "@/components/report-scaffold"

interface Row {
  clientId: string
  clientName: string
  ward: string | null
  direction: string | null
  group: string | null
  hasPaid: boolean
  isActivated: boolean
  lastVisit: string | null
  daysSinceVisit: number | null
  hasDiscrepancy: boolean
}

function YesNo({ ok }: { ok: boolean }) {
  return ok ? <Check className="size-4 text-green-600" /> : <X className="size-4 text-red-500" />
}

export default function ReconciliationReportPage() {
  const [onlyDiscrepancies, setOnly] = useState(false)
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/reconciliation", {
    onlyDiscrepancies: onlyDiscrepancies ? "true" : undefined,
  })
  const totalDiscrepancies = Number(metadata?.totalDiscrepancies ?? 0)

  const toggle = (
    <button onClick={() => setOnly((v) => !v)}>
      <Badge variant={onlyDiscrepancies ? "default" : "outline"}>Только расхождения</Badge>
    </button>
  )

  return (
    <ReportShell
      title="Сверка актива"
      subtitle="Активные клиенты без оплаты и без активированного абонемента — «мёртвые души»"
      pageKey="reports/attendance/reconciliation"
      actions={toggle}
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Направление</TableHead>
                  <TableHead className="text-center">Оплачен</TableHead>
                  <TableHead className="text-center">Активирован</TableHead>
                  <TableHead className="text-right">Дней без визита</TableHead>
                  <TableHead className="text-center">Расхождение</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.clientId} className={r.hasDiscrepancy ? "bg-red-50/50 dark:bg-red-950/20" : ""}>
                    <TableCell className="font-medium">
                      <Link href={`/crm/clients/${r.clientId}`} className="hover:underline">
                        {r.ward || r.clientName}
                      </Link>
                      {r.group && <div className="text-xs text-muted-foreground">{r.group}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{r.direction || "—"}</TableCell>
                    <TableCell className="text-center"><div className="flex justify-center"><YesNo ok={r.hasPaid} /></div></TableCell>
                    <TableCell className="text-center"><div className="flex justify-center"><YesNo ok={r.isActivated} /></div></TableCell>
                    <TableCell className="text-right">{r.daysSinceVisit ?? "—"}</TableCell>
                    <TableCell className="text-center">
                      {r.hasDiscrepancy && <Badge variant="outline" className="text-xs text-red-600 border-red-300">⚠</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {!loading && !error && (
        <p className="text-xs text-muted-foreground">Расхождений всего: {totalDiscrepancies}. Отчисление — всегда вручную администратором.</p>
      )}
    </ReportShell>
  )
}
