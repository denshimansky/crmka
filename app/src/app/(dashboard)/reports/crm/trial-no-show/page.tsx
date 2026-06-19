"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtDay } from "@/components/report-scaffold"

interface Row {
  id: string
  clientId: string
  clientName: string
  childName: string
  clientPhone: string | null
  group: string
  direction: string
  branch: string
  scheduledDate: string
  comment: string | null
}

export default function TrialNoShowReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/trial-no-show")
  const total = Number(metadata?.noShow ?? data.length)

  return (
    <ReportShell
      title="Не пришли на пробники"
      subtitle="Клиенты со статусом пробного «Не пришёл» за месяц (каждая неявка — отдельно)"
      pageKey="reports/crm/trial-no-show"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus
            loading={loading}
            error={error}
            empty={data.length === 0}
            emptyText="За месяц неявок на пробные нет"
          />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата пробного</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Ребёнок</TableHead>
                  <TableHead>Телефон</TableHead>
                  <TableHead>Направление</TableHead>
                  <TableHead>Группа</TableHead>
                  <TableHead>Филиал</TableHead>
                  <TableHead>Комментарий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{fmtDay(r.scheduledDate)}</TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/crm/clients/${r.clientId}`} className="hover:underline">
                        {r.clientName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{r.childName}</TableCell>
                    <TableCell className="text-sm">{r.clientPhone || "—"}</TableCell>
                    <TableCell className="text-sm">{r.direction}</TableCell>
                    <TableCell className="text-sm">{r.group}</TableCell>
                    <TableCell className="text-sm">{r.branch}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.comment || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {!loading && !error && data.length > 0 && (
        <p className="text-xs text-muted-foreground">Всего неявок: {total}</p>
      )}
    </ReportShell>
  )
}
