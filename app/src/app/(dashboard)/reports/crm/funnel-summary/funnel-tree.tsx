"use client"

import { Fragment, useState } from "react"
import { ChevronRight, ChevronDown } from "lucide-react"
import type { FunnelBranchNode, StageCounts } from "@/lib/reports/funnel-live"

// Столбцы = этапы воронки + «Связь» (последний). Порядок как в разделе «Продажи».
const STAGE_COLS: { key: keyof StageCounts; label: string }[] = [
  { key: "application", label: "Заявка" },
  { key: "trial_scheduled", label: "Назначено пробное" },
  { key: "trial_attended", label: "Прошёл пробное" },
  { key: "awaiting_payment", label: "Ожидает оплаты" },
  { key: "contact", label: "Связь" },
]

/** 0 показываем пусто, чтобы таблица не рябила нулями. */
function num(v: number): string {
  return v ? String(v) : ""
}

function branchKey(b: FunnelBranchNode): string {
  return b.branchId ?? "__no_branch__"
}

/**
 * Дерево «Филиал → Направление» со столбцами-этапами воронки (актуальность
 * «сейчас»). Строка филиала сворачивается/разворачивается шевроном, как в
 * Финрезе. «Связь» заполняется на уровне филиала и в «Всего» (по клиенту, не по
 * направлению), поэтому у направлений столбец пуст.
 */
export function FunnelTree({
  branches,
  totals,
}: {
  branches: FunnelBranchNode[]
  totals: StageCounts
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const setAll = (o: boolean) => setOpen(o ? new Set(branches.map(branchKey)) : new Set())

  return (
    <div className="overflow-x-auto">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Разворот:</span>
        <button
          type="button"
          onClick={() => setAll(true)}
          className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
        >
          Все направления
        </button>
        <button
          type="button"
          onClick={() => setAll(false)}
          className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
        >
          Свернуть
        </button>
      </div>

      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="py-1.5 text-left font-medium">Филиал / Направление</th>
            {STAGE_COLS.map((c) => (
              <th key={c.key} className="px-3 py-1.5 text-right font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {branches.length === 0 ? (
            <tr>
              <td colSpan={STAGE_COLS.length + 1} className="py-12 text-center text-sm text-muted-foreground">
                Нет активных заявок
              </td>
            </tr>
          ) : (
            branches.map((b) => {
              const id = branchKey(b)
              const isOpen = open.has(id)
              return (
                <Fragment key={id}>
                  {/* Уровень 1 — филиал */}
                  <tr className="border-b bg-muted/40">
                    <td className="py-1.5">
                      <button
                        type="button"
                        onClick={() => toggle(id)}
                        className="flex items-center gap-1 font-semibold"
                      >
                        {b.directions.length > 0 ? (
                          isOpen ? (
                            <ChevronDown className="size-4 shrink-0" />
                          ) : (
                            <ChevronRight className="size-4 shrink-0" />
                          )
                        ) : (
                          <span className="inline-block size-4 shrink-0" />
                        )}
                        {b.branchName}
                      </button>
                    </td>
                    {STAGE_COLS.map((c) => (
                      <td key={c.key} className="px-3 py-1.5 text-right font-semibold tabular-nums">
                        {num(b.counts[c.key])}
                      </td>
                    ))}
                  </tr>

                  {/* Уровень 2 — направления */}
                  {isOpen &&
                    b.directions.map((d) => (
                      <tr key={d.directionId ?? "__no_direction__"} className="border-b">
                        <td className="py-1 pl-6 text-muted-foreground">{d.directionName}</td>
                        {STAGE_COLS.map((c) => (
                          <td key={c.key} className="px-3 py-1 text-right tabular-nums text-muted-foreground">
                            {/* «Связь» — по клиенту, не по направлению → на направлении пусто */}
                            {c.key === "contact" ? "" : num(d.counts[c.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                </Fragment>
              )
            })
          )}

          {/* Итого */}
          {branches.length > 0 && (
            <tr className="border-t-2 font-bold">
              <td className="py-1.5">Всего</td>
              {STAGE_COLS.map((c) => (
                <td key={c.key} className="px-3 py-1.5 text-right tabular-nums">
                  {num(totals[c.key])}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
