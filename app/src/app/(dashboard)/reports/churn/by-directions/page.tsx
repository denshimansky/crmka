"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportObject } from "@/components/report-scaffold"
import { ChevronDown, ChevronRight } from "lucide-react"

interface Metrics {
  activeSubscriptions: number
  churned: number
  churnRate: number
}
interface DirectionNode extends Metrics {
  id: string
  name: string
}
interface BranchNode extends Metrics {
  id: string
  name: string
  directions: DirectionNode[]
}
interface Tree {
  total: Metrics
  branches: BranchNode[]
}

const TOTAL_KEY = "__total__"

/** Одна строка дерева: имя с отступом-«лесенкой», метрики оттока. */
function TreeRow({
  level,
  name,
  metrics,
  expandable,
  expanded,
  onToggle,
  bold,
}: {
  level: number
  name: string
  metrics: Metrics
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  bold?: boolean
}) {
  return (
    <TableRow
      className={onToggle ? "cursor-pointer hover:bg-muted/50" : undefined}
      onClick={onToggle}
    >
      <TableCell className={bold ? "font-bold" : "font-medium"}>
        <div className="flex items-center gap-1" style={{ paddingLeft: level * 20 }}>
          {expandable ? (
            expanded ? (
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            )
          ) : (
            <span className="inline-block size-4 shrink-0" />
          )}
          <span>{name}</span>
        </div>
      </TableCell>
      <TableCell className="text-right">{metrics.activeSubscriptions}</TableCell>
      <TableCell className="text-right text-red-600">{metrics.churned}</TableCell>
      <TableCell className="text-right font-bold">{metrics.churnRate}%</TableCell>
    </TableRow>
  )
}

export default function ChurnByDirectionsReportPage() {
  const { loading, error, data } = useReportObject<Tree>("/api/reports/churn-by-directions")
  // По умолчанию «Общее» развёрнуто — сразу видны филиалы; филиалы свёрнуты.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([TOTAL_KEY]))

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const isEmpty = !data || data.branches.length === 0

  return (
    <ReportShell
      title="Отток по направлениям и филиалам"
      subtitle="Активные абонементы прошлого месяца, не продлённые в текущем"
      pageKey="reports/churn/by-directions"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={isEmpty} />
          {!loading && !error && data && !isEmpty && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Филиал / направление</TableHead>
                  <TableHead className="text-right">Активные абонементы</TableHead>
                  <TableHead className="text-right">Отток</TableHead>
                  <TableHead className="text-right">% оттока</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TreeRow
                  level={0}
                  name="Общее"
                  metrics={data.total}
                  expandable
                  expanded={expanded.has(TOTAL_KEY)}
                  onToggle={() => toggle(TOTAL_KEY)}
                  bold
                />
                {expanded.has(TOTAL_KEY) &&
                  data.branches.flatMap((b) => {
                    const rows = [
                      <TreeRow
                        key={b.id}
                        level={1}
                        name={b.name}
                        metrics={b}
                        expandable={b.directions.length > 0}
                        expanded={expanded.has(b.id)}
                        onToggle={b.directions.length > 0 ? () => toggle(b.id) : undefined}
                      />,
                    ]
                    if (expanded.has(b.id)) {
                      for (const d of b.directions) {
                        rows.push(
                          <TreeRow key={`${b.id}:${d.id}`} level={2} name={d.name} metrics={d} />,
                        )
                      }
                    }
                    return rows
                  })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  )
}
