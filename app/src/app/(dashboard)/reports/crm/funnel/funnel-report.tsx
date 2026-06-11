"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  FUNNEL_SCHEME_LABELS,
  FUNNEL_STAGE_LABELS,
  FUNNEL_TAB_LABELS,
  type FunnelScheme,
  type FunnelStage,
  type FunnelStageKey,
  type FunnelTab,
  type SalesFunnelData,
} from "@/lib/reports/sales-funnel-types"

interface SelectedStage {
  tab: FunnelTab
  scheme: FunnelScheme
  stage: FunnelStage
}

// timeZone UTC: даты занятий/покупок (@db.Date) — полночь UTC, локальная TZ
// западнее UTC сместила бы их на день назад; и подсчёт месяца тоже идёт по UTC.
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { timeZone: "UTC" })
}

// Столбцы детализации зависят от этапа (по спецификации CRM-13).
function detailColumns(stage: FunnelStageKey): string[] {
  if (stage === "lead") return ["Дата", "Ребёнок", "Родитель", "Телефон"]
  const base = ["Дата", "Родитель", "Телефон", "Ребёнок", "Филиал", "Направление"]
  return stage === "application" ? base : [...base, "Группа"]
}

// У «Лид» и «Заявка» перетекающих не бывает — действие этапа = само создание.
function hasCarryover(stage: FunnelStageKey): boolean {
  return stage !== "lead" && stage !== "application"
}

export function SalesFunnelReport({ data }: { data: SalesFunnelData }) {
  const [selected, setSelected] = useState<SelectedStage | null>(null)

  const renderScheme = (tab: FunnelTab, scheme: FunnelScheme) => (
    <Card key={scheme.key}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{FUNNEL_SCHEME_LABELS[scheme.key]}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Этап</TableHead>
              <TableHead className="text-right">Текущий месяц</TableHead>
              <TableHead className="text-right">Перетекающие</TableHead>
              <TableHead className="text-right">Всего</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scheme.stages.map((stage) => {
              const total = stage.current + stage.carryover
              return (
                <TableRow
                  key={stage.key}
                  className="cursor-pointer"
                  onClick={() => setSelected({ tab, scheme, stage })}
                  title="Открыть детализацию"
                >
                  <TableCell className="font-medium">
                    {FUNNEL_STAGE_LABELS[stage.key]}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{stage.current}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {hasCarryover(stage.key) ? (
                      stage.carryover
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">{total}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )

  return (
    <>
      <Tabs defaultValue="new">
        <TabsList>
          <TabsTrigger value="new">{FUNNEL_TAB_LABELS.new}</TabsTrigger>
          <TabsTrigger value="existing">{FUNNEL_TAB_LABELS.existing}</TabsTrigger>
        </TabsList>
        {(["new", "existing"] as FunnelTab[]).map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {data[tab].map((scheme) => renderScheme(tab, scheme))}
            </div>
            {tab === "new" && (
              <p className="mt-3 text-xs text-muted-foreground">
                Этап «Лид» — все контакты, созданные за месяц: у лида ещё нет заявки,
                поэтому цифра одинакова в обеих схемах.
              </p>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <Sheet open={selected !== null} onOpenChange={(v) => { if (!v) setSelected(null) }}>
        <SheetContent
          side="right"
          // Модификатор data-[side=right] обязателен: базовые классы SheetContent
          // (w-3/4, sm:max-w-sm) заданы с ним и иначе побеждают по специфичности.
          className="data-[side=right]:w-full data-[side=right]:sm:max-w-none data-[side=right]:sm:w-[min(92vw,1100px)] overflow-y-auto"
        >
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {FUNNEL_STAGE_LABELS[selected.stage.key]} —{" "}
                  {FUNNEL_SCHEME_LABELS[selected.scheme.key]} (
                  {FUNNEL_TAB_LABELS[selected.tab].toLowerCase()})
                </SheetTitle>
                <SheetDescription>
                  Текущий месяц: {selected.stage.current}
                  {hasCarryover(selected.stage.key) &&
                    ` · перетекающие: ${selected.stage.carryover}`}
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">
                {selected.stage.rows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Нет данных</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {detailColumns(selected.stage.key).map((col) => (
                            <TableHead key={col} className="whitespace-nowrap">
                              {col}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selected.stage.rows.map((row, i) => {
                          const parentLink = (
                            <Link
                              href={`/crm/clients/${row.clientId}`}
                              className="text-primary hover:underline"
                            >
                              {row.parentName}
                            </Link>
                          )
                          return (
                            <TableRow key={`${row.clientId}-${i}`}>
                              <TableCell className="whitespace-nowrap">
                                {fmtDate(row.date)}
                                {row.carryover && hasCarryover(selected.stage.key) && (
                                  <Badge variant="outline" className="ml-1.5 text-[10px]">
                                    перетек.
                                  </Badge>
                                )}
                              </TableCell>
                              {selected.stage.key === "lead" ? (
                                <>
                                  <TableCell>{row.wardName ?? "—"}</TableCell>
                                  <TableCell>{parentLink}</TableCell>
                                  <TableCell className="whitespace-nowrap">
                                    {row.phone ?? "—"}
                                  </TableCell>
                                </>
                              ) : (
                                <>
                                  <TableCell>{parentLink}</TableCell>
                                  <TableCell className="whitespace-nowrap">
                                    {row.phone ?? "—"}
                                  </TableCell>
                                  <TableCell>{row.wardName ?? "—"}</TableCell>
                                  <TableCell>{row.branchName ?? "—"}</TableCell>
                                  <TableCell>{row.directionName ?? "—"}</TableCell>
                                  {selected.stage.key !== "application" && (
                                    <TableCell>{row.groupName ?? "—"}</TableCell>
                                  )}
                                </>
                              )}
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
