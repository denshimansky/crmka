"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ReportShell, ReportStatus, useReportData } from "@/components/report-scaffold"

interface ChurnedClient {
  clientId: string
  clientName: string
  withdrawalDate: string
  direction: string | null
  reason: string | null
}

interface Row {
  instructorId: string
  instructorName: string
  activeSubscriptions: number
  newSubscriptions: number
  churned: number
  activeAtEnd: number
  churnedClients: ChurnedClient[]
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export default function SubscriptionsByInstructorReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/subscriptions-by-instructor")
  const num = (k: string) => Number((metadata as Record<string, unknown> | null)?.[k] ?? 0)

  // Выбранный педагог для просмотра списка выбывших (drill-down, баг #22).
  const [churnedView, setChurnedView] = useState<{ name: string; list: ChurnedClient[] } | null>(null)

  return (
    <ReportShell
      title="Сводный по абонементам в разрезе педагогов"
      subtitle="Активные, новые, выбывшие абонементы и активные на конец месяца — по педагогам"
      pageKey="reports/crm/subscriptions-by-instructor"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Педагог</TableHead>
                  <TableHead className="text-right">Активные</TableHead>
                  <TableHead className="text-right">Новые</TableHead>
                  <TableHead className="text-right">Выбывшие</TableHead>
                  <TableHead className="text-right">Активные на конец</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.instructorId}>
                    <TableCell className="font-medium">{r.instructorName}</TableCell>
                    <TableCell className="text-right">{r.activeSubscriptions}</TableCell>
                    <TableCell className="text-right text-green-600">{r.newSubscriptions}</TableCell>
                    <TableCell className="text-right text-red-600">
                      {r.churned > 0 ? (
                        <button
                          type="button"
                          className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                          onClick={() => setChurnedView({ name: r.instructorName, list: r.churnedClients })}
                          title="Показать, кто выбыл"
                        >
                          {r.churned}
                        </button>
                      ) : (
                        r.churned
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">{r.activeAtEnd}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell>Итого</TableCell>
                  <TableCell className="text-right">{num("totalActive")}</TableCell>
                  <TableCell className="text-right text-green-600">{num("totalNew")}</TableCell>
                  <TableCell className="text-right text-red-600">{num("totalChurned")}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!churnedView} onOpenChange={(v) => { if (!v) setChurnedView(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Выбывшие за месяц — {churnedView?.name}</DialogTitle>
          </DialogHeader>
          {churnedView && churnedView.list.length > 0 ? (
            <div className="max-h-[60vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Клиент</TableHead>
                    <TableHead>Направление</TableHead>
                    <TableHead>Дата выбытия</TableHead>
                    <TableHead>Причина</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {churnedView.list.map((c, i) => (
                    <TableRow key={`${c.clientId}-${i}`}>
                      <TableCell className="font-medium">
                        <Link href={`/crm/clients/${c.clientId}`} className="hover:underline">
                          {c.clientName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{c.direction || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{fmtDate(c.withdrawalDate)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.reason || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">Нет выбывших.</p>
          )}
        </DialogContent>
      </Dialog>
    </ReportShell>
  )
}
