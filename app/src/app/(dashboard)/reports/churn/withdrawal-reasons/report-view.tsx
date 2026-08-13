"use client"

import { useTransition } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { StickyHScroll } from "@/components/sticky-h-scroll"

const ALL_VALUE = "__all__"

export interface SummaryRow {
  reason: string
  isNoReason: boolean
  counts: number[] // выровнены по days
  total: number
}

export interface DetailRow {
  id: string
  clientId: string
  clientName: string
  branch: string
  direction: string
  reason: string
  date: string // "DD.MM"
  dateKey: string
}

interface DayCol {
  key: string
  label: string
}

export function WithdrawalReasonsView({
  days,
  summaryRows,
  columnTotals,
  grandTotal,
  detailRows,
  branches,
  branchId,
  withdrawnCount,
  reasonsCount,
}: {
  days: DayCol[]
  summaryRows: SummaryRow[]
  columnTotals: number[]
  grandTotal: number
  detailRows: DetailRow[]
  branches: { id: string; name: string }[]
  branchId: string
  withdrawnCount: number
  reasonsCount: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  // Фильтр филиала меняет выборку → навигация по URL (year/month сохраняем).
  const onBranchChange = (v: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (!v || v === ALL_VALUE) params.delete("branchId")
    else params.set("branchId", v)
    startTransition(() => router.replace(`${pathname}?${params.toString()}`))
  }

  const selectedBranch = branches.find((b) => b.id === branchId)
  const isEmpty = withdrawnCount === 0

  return (
    <div className="space-y-4">
      {/* Фильтр филиала + карточки-итоги */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Филиал</Label>
          <Select value={branchId || ALL_VALUE} onValueChange={onBranchChange}>
            <SelectTrigger className="h-9 w-[220px]" disabled={pending}>
              {selectedBranch ? selectedBranch.name : "Все филиалы"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Все филиалы</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Выбывших абонементов</p>
              <p className="text-2xl font-bold text-red-600">{withdrawnCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Задействовано причин</p>
              <p className="text-2xl font-bold">{reasonsCount}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {isEmpty ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет отчислений за выбранный период
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="summary">
          <TabsList>
            <TabsTrigger value="summary">Сводная</TabsTrigger>
            <TabsTrigger value="details">Детализация</TabsTrigger>
          </TabsList>

          {/* Сводная — матрица причина × день */}
          <TabsContent value="summary" className="space-y-2">
            <StickyHScroll className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 min-w-[220px] bg-background">
                      Причина
                    </TableHead>
                    {days.map((d) => (
                      <TableHead
                        key={d.key}
                        className="whitespace-nowrap text-center tabular-nums"
                      >
                        {d.label}
                      </TableHead>
                    ))}
                    <TableHead className="whitespace-nowrap text-center font-semibold">
                      Итого за месяц
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryRows.map((r) => (
                    <TableRow key={r.reason}>
                      <TableCell className="sticky left-0 z-10 bg-background font-medium">
                        {r.reason}
                      </TableCell>
                      {r.counts.map((c, i) => (
                        <TableCell
                          key={days[i].key}
                          className="text-center tabular-nums"
                        >
                          {c > 0 ? (
                            c
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      ))}
                      <TableCell className="text-center font-semibold tabular-nums">
                        {r.total}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Итого по дням + общий итог */}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell className="sticky left-0 z-10 bg-background">
                      Итого
                    </TableCell>
                    {columnTotals.map((t, i) => (
                      <TableCell
                        key={days[i].key}
                        className="text-center tabular-nums"
                      >
                        {t}
                      </TableCell>
                    ))}
                    <TableCell className="text-center tabular-nums">
                      {grandTotal}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </StickyHScroll>
            <p className="text-xs text-muted-foreground">
              Строка — причина отчисления, столбец — день месяца. В ячейке — число
              отчисленных абонементов.
            </p>
          </TabsContent>

          {/* Детализация — одна строка на абонемент */}
          <TabsContent value="details" className="space-y-2">
            <StickyHScroll className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Филиал</TableHead>
                    <TableHead>Клиент</TableHead>
                    <TableHead>Направление</TableHead>
                    <TableHead>Причина</TableHead>
                    <TableHead className="whitespace-nowrap">
                      Дата отчисления
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground">
                        {r.branch}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/crm/clients/${r.clientId}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {r.clientName}
                        </Link>
                      </TableCell>
                      <TableCell>{r.direction}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.reason}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {r.date}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </StickyHScroll>
            <p className="text-xs text-muted-foreground">
              Отчислено абонементов: {detailRows.length} · одна строка — один
              отчисленный абонемент
            </p>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
