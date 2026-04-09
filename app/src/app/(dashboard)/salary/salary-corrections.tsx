"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { AlertTriangle } from "lucide-react"

interface Correction {
  periodYear: number
  periodMonth: number
  instructorId: string
  instructorName: string
  originalAmount: number
  correctedAmount: number
  difference: number
  correctionCount: number
}

interface CorrectionsResponse {
  corrections: Correction[]
  totals: { totalDifference: number }
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount)) + " ₽"
}

function formatDifference(amount: number): string {
  const prefix = amount > 0 ? "+" : ""
  return prefix + formatMoney(amount)
}

function getMonthName(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  })
}

export function SalaryCorrections({ year, month }: { year: number; month: number }) {
  const [data, setData] = useState<CorrectionsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/salary-corrections?year=${year}&month=${month}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [year, month])

  if (loading) return null
  if (!data || data.corrections.length === 0) return null

  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-amber-600" />
          Корректировки закрытых периодов
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-700">
                  {data.corrections.length}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>Изменения, внесённые после закрытия периода</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-amber-200">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-amber-50">
                <TableHead>Сотрудник</TableHead>
                <TableHead>Период</TableHead>
                <TableHead className="text-right">Было</TableHead>
                <TableHead className="text-right">Стало</TableHead>
                <TableHead className="text-right">Разница</TableHead>
                <TableHead className="text-center">Записей</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.corrections.map((c, i) => (
                <TableRow key={`${c.instructorId}-${c.periodYear}-${c.periodMonth}-${i}`} className="hover:bg-amber-50">
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {c.instructorName}
                      <Badge
                        variant="outline"
                        className="border-amber-300 bg-amber-100 text-amber-700 text-[10px] px-1.5"
                      >
                        Корректировка
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-normal">
                      {getMonthName(c.periodYear, c.periodMonth)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {c.originalAmount > 0 ? formatMoney(c.originalAmount) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoney(c.correctedAmount)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      c.difference > 0 ? "text-green-600" : c.difference < 0 ? "text-red-600" : ""
                    }`}
                  >
                    {formatDifference(c.difference)}
                  </TableCell>
                  <TableCell className="text-center text-muted-foreground">
                    {c.correctionCount}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-bold hover:bg-amber-50">
                <TableCell colSpan={4}>Итого влияние корректировок</TableCell>
                <TableCell
                  className={`text-right ${
                    data.totals.totalDifference > 0
                      ? "text-green-600"
                      : data.totals.totalDifference < 0
                        ? "text-red-600"
                        : ""
                  }`}
                >
                  {formatDifference(data.totals.totalDifference)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
