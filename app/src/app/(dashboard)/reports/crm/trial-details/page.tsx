"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtDay } from "@/components/report-scaffold"

interface Row {
  id: string
  clientId: string
  clientName: string
  clientPhone: string | null
  wardName: string | null
  group: string
  direction: string
  branch: string
  instructor: string
  status: string
  scheduledDate: string
  attendedAt: string | null
  comment: string | null
}

const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Назначен", cls: "text-muted-foreground" },
  attended: { label: "Пришёл", cls: "text-green-600 border-green-300" },
  no_show: { label: "Не пришёл", cls: "text-orange-600 border-orange-300" },
  cancelled: { label: "Отменён", cls: "text-muted-foreground" },
}

export default function TrialDetailsReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/trial-details")
  const total = Number(metadata?.total ?? data.length)

  return (
    <ReportShell
      title="Детализация пробников"
      subtitle="Все пробные занятия за месяц с педагогом, статусом и датой посещения"
      pageKey="reports/crm/trial-details"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Записан</TableHead>
                  <TableHead>Клиент / ребёнок</TableHead>
                  <TableHead>Направление</TableHead>
                  <TableHead>Группа</TableHead>
                  <TableHead>Педагог</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Посетил</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => {
                  const st = STATUS[r.status] || { label: r.status, cls: "" }
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-sm">{fmtDay(r.scheduledDate)}</TableCell>
                      <TableCell>
                        <Link href={`/crm/clients/${r.clientId}`} className="font-medium hover:underline">
                          {r.wardName || r.clientName}
                        </Link>
                        {r.wardName && <div className="text-xs text-muted-foreground">{r.clientName}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{r.direction}</TableCell>
                      <TableCell className="text-sm">{r.group}</TableCell>
                      <TableCell className="text-sm">{r.instructor}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${st.cls}`}>
                          {st.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.attendedAt ? fmtDay(r.attendedAt) : "—"}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {!loading && !error && data.length > 0 && (
        <p className="text-xs text-muted-foreground">Всего пробных за месяц: {total}</p>
      )}
    </ReportShell>
  )
}
