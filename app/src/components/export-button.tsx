"use client"

import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"

interface ExportButtonProps {
  onClick: () => void
  loading?: boolean
  disabled?: boolean
  label?: string
}

export function ExportButton({
  onClick,
  loading = false,
  disabled = false,
  label = "Скачать Excel",
}: ExportButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled || loading}
    >
      <Download className="mr-1 size-3.5" />
      {loading ? "Экспорт..." : label}
    </Button>
  )
}
