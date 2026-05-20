"use client"

import * as React from "react"
import { TableHead } from "@/components/ui/table"
import { ArrowUp, ArrowDown, ArrowUpDown, GripVertical } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SortDir } from "@/hooks/use-table-prefs"

interface SortableTableHeadProps {
  /** Ключ колонки (для сортировки и DnD) */
  columnKey: string
  /** Видимая подпись */
  label: React.ReactNode
  /** Текущая активная колонка сортировки */
  activeSortKey: string | null
  /** Текущее направление сортировки */
  sortDir: SortDir
  /** Колонка поддерживает сортировку (можно отключить для action-колонок) */
  sortable?: boolean
  /** Обработчик клика по заголовку */
  onSortClick: (key: string) => void
  /** Обработчик перемещения столбца (источник, цель) */
  onMove: (from: string, to: string) => void
  /** Дополнительный className */
  className?: string
  /** Выравнивание содержимого, в т.ч. для числовых колонок */
  align?: "left" | "right" | "center"
}

const MIME = "application/x-crmka-col"

export function SortableTableHead({
  columnKey,
  label,
  activeSortKey,
  sortDir,
  sortable = true,
  onSortClick,
  onMove,
  className,
  align = "left",
}: SortableTableHeadProps) {
  const isActive = activeSortKey === columnKey
  const [isDragOver, setIsDragOver] = React.useState(false)

  const SortIcon = !sortable
    ? null
    : !isActive
      ? ArrowUpDown
      : sortDir === "asc"
        ? ArrowUp
        : ArrowDown

  function handleDragStart(e: React.DragEvent<HTMLTableCellElement>) {
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData(MIME, columnKey)
    // Fallback для браузеров, где кастомный MIME не работает
    e.dataTransfer.setData("text/plain", columnKey)
  }

  function handleDragOver(e: React.DragEvent<HTMLTableCellElement>) {
    if (
      e.dataTransfer.types.includes(MIME) ||
      e.dataTransfer.types.includes("text/plain")
    ) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      setIsDragOver(true)
    }
  }

  function handleDragLeave() {
    setIsDragOver(false)
  }

  function handleDrop(e: React.DragEvent<HTMLTableCellElement>) {
    e.preventDefault()
    setIsDragOver(false)
    const from =
      e.dataTransfer.getData(MIME) || e.dataTransfer.getData("text/plain")
    if (from && from !== columnKey) {
      onMove(from, columnKey)
    }
  }

  return (
    <TableHead
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "group select-none",
        isDragOver && "bg-primary/10",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
      title="Кликните для сортировки. Перетащите, чтобы переместить столбец"
    >
      <div
        className={cn(
          "flex items-center gap-1.5",
          align === "right" && "justify-end",
          align === "center" && "justify-center",
        )}
      >
        <GripVertical
          className="size-3 shrink-0 cursor-grab text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 hover:text-foreground",
            !sortable && "cursor-default",
            isActive && "text-foreground",
          )}
          onClick={() => sortable && onSortClick(columnKey)}
          disabled={!sortable}
        >
          <span>{label}</span>
          {SortIcon && (
            <SortIcon
              className={cn(
                "size-3.5 shrink-0 transition-opacity",
                isActive ? "opacity-100" : "opacity-30 group-hover:opacity-60",
              )}
            />
          )}
        </button>
      </div>
    </TableHead>
  )
}
