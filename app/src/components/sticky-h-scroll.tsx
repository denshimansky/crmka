"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Обёртка для широких таблиц: полоса горизонтального скролла видна всегда —
 * прилипает к нижнему краю окна, пока таблица в кадре (раньше до полосы
 * приходилось проматывать страницу до самого конца таблицы).
 *
 * Родной скроллбар контейнера shadcn-таблицы (div[data-slot=table-container])
 * прячем, снизу рисуем sticky-«двойник» той же ширины и синхронизируем
 * прокрутку в обе стороны. Если таблица влезает по ширине — полоса скрыта.
 */
export function StickyHScroll({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [contentWidth, setContentWidth] = useState(0)
  const [visibleWidth, setVisibleWidth] = useState(0)

  useEffect(() => {
    const wrap = wrapRef.current
    const bar = barRef.current
    if (!wrap || !bar) return
    const scroller = wrap.querySelector<HTMLElement>('[data-slot="table-container"]')
    if (!scroller) return

    const update = () => {
      setContentWidth(scroller.scrollWidth)
      setVisibleWidth(scroller.clientWidth)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(scroller)
    if (scroller.firstElementChild) ro.observe(scroller.firstElementChild)

    // Флаг гасит эхо: программная установка scrollLeft сама порождает событие.
    let syncing = false
    const onScroller = () => {
      if (syncing) {
        syncing = false
        return
      }
      syncing = true
      bar.scrollLeft = scroller.scrollLeft
    }
    const onBar = () => {
      if (syncing) {
        syncing = false
        return
      }
      syncing = true
      scroller.scrollLeft = bar.scrollLeft
    }
    scroller.addEventListener("scroll", onScroller, { passive: true })
    bar.addEventListener("scroll", onBar, { passive: true })
    return () => {
      ro.disconnect()
      scroller.removeEventListener("scroll", onScroller)
      bar.removeEventListener("scroll", onBar)
    }
  }, [])

  const hasOverflow = contentWidth > visibleWidth + 1

  return (
    <div
      ref={wrapRef}
      className={cn(
        "[&_[data-slot=table-container]]:[scrollbar-width:none] [&_[data-slot=table-container]::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {children}
      <div
        ref={barRef}
        className={cn(
          "sticky bottom-0 z-10 h-3.5 overflow-x-auto overflow-y-hidden bg-card",
          hasOverflow ? "block" : "hidden",
        )}
      >
        <div style={{ width: contentWidth, height: 1 }} />
      </div>
    </div>
  )
}
