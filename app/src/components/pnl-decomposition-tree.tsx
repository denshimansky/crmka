"use client"

import { Fragment, useState } from "react"
import { ChevronRight, ChevronDown } from "lucide-react"
import { formatMoney } from "@/lib/currency"
import { cn } from "@/lib/utils"

// DTO дерева (сериализуемые данные из lib/pnl-decomposition — только числа/строки).
export interface DecompStatyaDTO {
  name: string
  income: number
  expense: number
}
export interface DecompDirectionDTO {
  id: string
  directionId: string
  name: string
  income: number
  expense: number
  profit: number
  statyi: DecompStatyaDTO[]
}
export interface DecompBranchDTO {
  id: string
  branchId: string
  name: string
  income: number
  expense: number
  profit: number
  directions: DecompDirectionDTO[]
}

interface Props {
  branches: DecompBranchDTO[]
  totals: { income: number; expense: number; profit: number }
  currency: string
}

/**
 * Дерево «Филиал → Направление → Статья» с колонками Доход / Расход / Прибыль.
 * Первый столбец сворачивается/разворачивается: кнопки «Развернуть до» (Филиалы /
 * Направления / Статьи) задают глобальный уровень, шеврон у строки — точечно.
 */
export function PnlDecompositionTree({ branches, totals, currency }: Props) {
  // По умолчанию раскрыты филиалы (видны направления), статьи скрыты.
  const [openBranches, setOpenBranches] = useState<Set<string>>(() => new Set(branches.map((b) => b.id)))
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set())

  const money = (n: number) => formatMoney(n, currency, { decimals: 0 })

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setter(next)
  }
  const expandTo = (level: "branch" | "direction" | "statya") => {
    if (level === "branch") {
      setOpenBranches(new Set())
      setOpenDirs(new Set())
    } else if (level === "direction") {
      setOpenBranches(new Set(branches.map((b) => b.id)))
      setOpenDirs(new Set())
    } else {
      setOpenBranches(new Set(branches.map((b) => b.id)))
      setOpenDirs(new Set(branches.flatMap((b) => b.directions.map((d) => d.id))))
    }
  }

  const incomeCls = "text-right px-3 tabular-nums whitespace-nowrap text-green-700"
  const expenseCls = "text-right px-3 tabular-nums whitespace-nowrap text-red-600"
  const profitCls = (n: number) => cn("text-right px-3 tabular-nums whitespace-nowrap font-medium", n >= 0 ? "text-green-700" : "text-red-700")

  const LevelButton = ({ level, label }: { level: "branch" | "direction" | "statya"; label: string }) => (
    <button
      type="button"
      onClick={() => expandTo(level)}
      className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
    >
      {label}
    </button>
  )

  return (
    <div className="overflow-x-auto">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Развернуть до:</span>
        <LevelButton level="branch" label="Филиалы" />
        <LevelButton level="direction" label="Направления" />
        <LevelButton level="statya" label="Статьи" />
      </div>

      <table className="w-full min-w-[440px] text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="py-1.5 text-left font-medium">Филиал / Направление / Статья</th>
            <th className="py-1.5 px-3 text-right font-medium">Доход</th>
            <th className="py-1.5 px-3 text-right font-medium">Расход</th>
            <th className="py-1.5 px-3 text-right font-medium">Прибыль&nbsp;(убыток)</th>
          </tr>
        </thead>
        <tbody>
          {branches.map((b) => {
            const bOpen = openBranches.has(b.id)
            return (
              <Fragment key={b.id}>
                {/* Уровень 1 — филиал */}
                <tr className="border-b bg-muted/40">
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => toggle(openBranches, b.id, setOpenBranches)}
                      className="flex items-center gap-1 font-semibold"
                    >
                      {b.directions.length > 0 ? (
                        bOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />
                      ) : (
                        <span className="inline-block size-4 shrink-0" />
                      )}
                      {b.name}
                    </button>
                  </td>
                  <td className={cn(incomeCls, "font-semibold")}>{money(b.income)}</td>
                  <td className={cn(expenseCls, "font-semibold")}>{money(b.expense)}</td>
                  <td className={profitCls(b.profit)}>{money(b.profit)}</td>
                </tr>

                {bOpen &&
                  b.directions.map((d) => {
                    const dOpen = openDirs.has(d.id)
                    return (
                      <Fragment key={d.id}>
                        {/* Уровень 2 — направление */}
                        <tr className="border-b">
                          <td className="py-1 pl-5">
                            <button
                              type="button"
                              onClick={() => toggle(openDirs, d.id, setOpenDirs)}
                              className="flex items-center gap-1"
                            >
                              {d.statyi.length > 0 ? (
                                dOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />
                              ) : (
                                <span className="inline-block size-4 shrink-0" />
                              )}
                              {d.name}
                            </button>
                          </td>
                          <td className={incomeCls}>{money(d.income)}</td>
                          <td className={expenseCls}>{money(d.expense)}</td>
                          <td className={profitCls(d.profit)}>{money(d.profit)}</td>
                        </tr>

                        {dOpen &&
                          d.statyi.map((s, i) => (
                            // Уровень 3 — статья (только доход ИЛИ расход, прибыль пустая)
                            <tr key={`${d.id}-${i}`} className="border-b text-muted-foreground">
                              <td className="py-0.5 pl-12">{s.name}</td>
                              <td className={incomeCls}>{s.income ? money(s.income) : ""}</td>
                              <td className={expenseCls}>{s.expense ? money(s.expense) : ""}</td>
                              <td />
                            </tr>
                          ))}
                      </Fragment>
                    )
                  })}
              </Fragment>
            )
          })}

          {/* Итого */}
          <tr className="border-t-2 font-bold">
            <td className="py-1.5">Итого</td>
            <td className={cn(incomeCls, "font-bold")}>{money(totals.income)}</td>
            <td className={cn(expenseCls, "font-bold")}>{money(totals.expense)}</td>
            <td className={profitCls(totals.profit)}>{money(totals.profit)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
