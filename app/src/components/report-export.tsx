"use client"

import { ExportButton } from "@/components/export-button"
import { exportToExcel } from "@/lib/export-excel"

interface ReportExportProps {
  title: string
  filename: string
  columns: { header: string; key: string; width?: number }[]
  rows: Record<string, any>[]
  sheetName?: string
  period?: string
}

export function ReportExport({
  title,
  filename,
  columns,
  rows,
  sheetName,
  period,
}: ReportExportProps) {
  function handleExport() {
    exportToExcel({
      title,
      columns,
      rows,
      filename,
      sheetName,
      metadata: {
        period,
        generated: new Date().toLocaleDateString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    })
  }

  return <ExportButton onClick={handleExport} disabled={rows.length === 0} />
}
