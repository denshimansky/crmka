"use client"

import { useState, useCallback } from "react"
import { DrillDownSheet } from "@/components/drill-down-sheet"

interface DrillDownData {
  columns: string[]
  rows: (string | number)[][]
}

interface DrilldownAmountProps {
  amount: string
  report: string
  field: string
  month: string
  title: string
  description?: string
  className?: string
  /** Дополнительные query-параметры к API drill-down (categoryId, branchId, incomeCategoryId и т.п.). */
  extraParams?: Record<string, string | undefined>
}

export function DrilldownAmount({
  amount,
  report,
  field,
  month,
  title,
  description,
  className = "",
  extraParams,
}: DrilldownAmountProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<DrillDownData | null>(null)

  const handleClick = useCallback(async () => {
    setOpen(true)
    setLoading(true)
    try {
      const params = new URLSearchParams({ report, field, month })
      if (extraParams) {
        for (const [k, v] of Object.entries(extraParams)) {
          if (v) params.set(k, v)
        }
      }
      const res = await fetch(`/api/reports/drill-down?${params.toString()}`)
      if (res.ok) {
        setData(await res.json())
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [report, field, month, extraParams])

  return (
    <>
      <span
        className={`cursor-pointer underline decoration-dotted underline-offset-4 hover:decoration-solid ${className}`}
        onClick={handleClick}
      >
        {amount}
      </span>
      <DrillDownSheet
        title={title}
        description={description}
        isOpen={open}
        onClose={() => setOpen(false)}
        data={data}
        isLoading={loading}
      />
    </>
  )
}
