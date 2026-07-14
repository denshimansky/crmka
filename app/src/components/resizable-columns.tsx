"use client"

// Изменяемая ширина столбцов таблиц (перетаскивание за вертикальную полоску
// на правом краю заголовка). Общий модуль для таблиц CRM: «Клиенты»,
// «Продажи», «Дети», «Абонементы», «Пропуски».
//
// Использование:
//   const { widthOf, startResize } = useColumnWidths(`foo-colw:${tab}`, DEFAULTS)
//   <Table className={RESIZABLE_TABLE_CLASS}> — table-fixed + обрезка текста
//   <ResizableHead id="phone" width={widthOf("phone")} onResizeStart={startResize}>
//     Телефон (или кнопка сортировки)
//   </ResizableHead>
//
// Ширины хранятся в localStorage по ключу storageKey; не влезающий текст в
// ячейках обрезается многоточием (table-fixed + overflow-hidden на td).

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"
import { TableHead } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export const MIN_COL_WIDTH = 60

// table-fixed обязателен: без него браузер растягивает колонки под контент и
// уменьшение ширины не обрезает текст.
export const RESIZABLE_TABLE_CLASS =
  "table-fixed [&_td]:overflow-hidden [&_td]:text-ellipsis [&_td]:whitespace-nowrap"

export function useColumnWidths(
  storageKey: string,
  defaults: Record<string, number>,
): {
  widthOf: (id: string) => number
  startResize: (id: string, e: ReactMouseEvent) => void
} {
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      const parsed = raw ? (JSON.parse(raw) as unknown) : null
      setColWidths(parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {})
    } catch {
      setColWidths({})
    }
  }, [storageKey])
  const colWidthsRef = useRef(colWidths)
  colWidthsRef.current = colWidths

  function widthOf(id: string): number {
    const w = colWidths[id]
    return typeof w === "number" && Number.isFinite(w) ? Math.max(MIN_COL_WIDTH, w) : defaults[id] ?? 140
  }

  function startResize(id: string, e: ReactMouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthOf(id)
    function onMove(ev: MouseEvent) {
      const w = Math.max(MIN_COL_WIDTH, startW + (ev.clientX - startX))
      setColWidths((prev) => ({ ...prev, [id]: w }))
    }
    function onUp(ev: MouseEvent) {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      // Финальная ширина — из координаты mouseup, а не из ref: setState из
      // mousemove может ещё не отрендериться (и не попасть в ref) к моменту
      // отпускания — иначе при быстром драге сохранится устаревшая ширина.
      const w = Math.max(MIN_COL_WIDTH, startW + (ev.clientX - startX))
      try {
        localStorage.setItem(storageKey, JSON.stringify({ ...colWidthsRef.current, [id]: w }))
      } catch {
        /* недоступный storage — игнорируем */
      }
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  return { widthOf, startResize }
}

/** Видимая вертикальная полоска-ручка на правом краю заголовка. */
export function ResizeHandle({ onMouseDown }: { onMouseDown: (e: ReactMouseEvent) => void }) {
  return (
    <span
      onMouseDown={onMouseDown}
      className="group/resize absolute inset-y-0 right-0 flex w-2.5 cursor-col-resize touch-none select-none items-center justify-end"
      title="Потянуть, чтобы изменить ширину столбца"
    >
      <span className="pointer-events-none mr-0.5 h-2/3 w-px rounded bg-border transition-all group-hover/resize:w-[3px] group-hover/resize:bg-primary" />
    </span>
  )
}

/** Заголовок столбца с фиксированной шириной и ручкой ресайза.
 *  children — текст либо кнопка сортировки таблицы-хозяина. */
export function ResizableHead({
  id,
  width,
  onResizeStart,
  className,
  children,
}: {
  id: string
  width: number
  onResizeStart: (id: string, e: ReactMouseEvent) => void
  className?: string
  children: ReactNode
}) {
  return (
    <TableHead
      className={cn("relative overflow-hidden whitespace-nowrap pr-3", className)}
      style={{ width, minWidth: width, maxWidth: width }}
    >
      {children}
      <ResizeHandle onMouseDown={(e) => onResizeStart(id, e)} />
    </TableHead>
  )
}
