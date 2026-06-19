"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  ReportShell,
  ReportStatus,
  fmtMoney,
  useReportData,
} from "@/components/report-scaffold"

interface ClientRow {
  id: string
  name: string
  metric: number
  branchName: string | null
  manual: boolean
}

interface Row {
  segment: string
  label: string
  count: number
  clients: ClientRow[]
}

// Подзаголовок и формат метрики зависят от режима сегментации в Настройках.
function modeSubtitle(mode: string | null, configured: boolean): string {
  if (!configured) {
    return "Пороги сегментации не настроены — все активные клиенты «Новый» (кроме заданных вручную). Снимок на сегодня"
  }
  if (mode === "amount") {
    return "Активные клиенты по сегментам — по сумме отработанной выручки (снимок на сегодня)"
  }
  return "Активные клиенты по сегментам — по времени с первой оплаты (снимок на сегодня)"
}

function fmtMetric(value: number, mode: string | null): string {
  if (mode === "months") return `${value} мес.`
  return fmtMoney(value)
}

export default function SegmentationReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/client-segmentation")
  const [selected, setSelected] = useState<Row | null>(null)

  const total = Number(metadata?.totalClients ?? 0)
  const mode = (metadata?.mode ?? null) as string | null
  const configured = Boolean(metadata?.configured)

  return (
    <ReportShell
      title="Сегментация клиентов"
      subtitle={
        metadata
          ? modeSubtitle(mode, configured)
          : "Активные клиенты по сегментам — снимок на сегодня"
      }
      pageKey="reports/crm/segmentation"
      period={false}
    >
      <Card>
        <CardContent className="p-0">
          {/* API всегда отдаёт 4 строки сегментов, поэтому «пусто» определяем по
              числу активных клиентов, а не по длине data (иначе emptyText мёртв,
              а у тенанта без активных рисуется «Всего: 0 … 100%»). */}
          <ReportStatus loading={loading} error={error} empty={total === 0} emptyText="Активных клиентов нет" />
          {!loading && !error && total > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Сегмент</TableHead>
                  <TableHead className="text-right">Клиентов</TableHead>
                  <TableHead className="text-right">Доля</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow
                    key={r.segment}
                    className={r.count > 0 ? "cursor-pointer" : ""}
                    onClick={() => r.count > 0 && setSelected(r)}
                    title={r.count > 0 ? "Открыть список клиентов" : undefined}
                  >
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.count > 0 ? (
                        <span className="underline-offset-2 hover:underline">{r.count}</span>
                      ) : (
                        r.count
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {total > 0 ? `${Math.round((r.count / total) * 100)}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell>Всего активных</TableCell>
                  <TableCell className="text-right tabular-nums">{total}</TableCell>
                  <TableCell className="text-right text-muted-foreground">100%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={selected !== null} onOpenChange={(v) => { if (!v) setSelected(null) }}>
        <SheetContent
          side="right"
          className="data-[side=right]:w-full data-[side=right]:sm:max-w-none data-[side=right]:sm:w-[min(92vw,720px)] overflow-y-auto"
        >
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.label}</SheetTitle>
                <SheetDescription>
                  Активных клиентов: {selected.count}
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">
                {selected.clients.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Нет данных</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Клиент</TableHead>
                          <TableHead className="text-right whitespace-nowrap">
                            {mode === "months" ? "Стаж" : "Σ выручка"}
                          </TableHead>
                          <TableHead>Филиал</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selected.clients.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell>
                              <Link
                                href={`/crm/clients/${c.id}`}
                                className="text-primary hover:underline"
                              >
                                {c.name}
                              </Link>
                              {c.manual && (
                                <Badge variant="outline" className="ml-1.5 text-[10px]">
                                  вручную
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums whitespace-nowrap">
                              {configured ? fmtMetric(c.metric, mode) : "—"}
                            </TableCell>
                            <TableCell>{c.branchName ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </ReportShell>
  )
}
