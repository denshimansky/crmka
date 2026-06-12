"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

const BAR_HEIGHT = 12
const THUMB_MIN_WIDTH = 30

interface BarState {
  top: number
  left: number
  width: number
  thumbLeft: number
  thumbWidth: number
}

/**
 * Обёртка для широких таблиц: полоса горизонтального скролла видна всегда —
 * прижата к нижнему краю окна, пока таблица в кадре (раньше до полосы
 * приходилось проматывать страницу до конца таблицы).
 *
 * position: sticky здесь не работает (main в layout имеет overflow-x-hidden и
 * становится clip-ancestor'ом, а скроллится документ), а нативный скроллбар на
 * Windows 11 — overlay и прячется, пока его не тронешь. Поэтому: родной
 * скроллбар контейнера shadcn-таблицы (div[data-slot=table-container]) прячем,
 * а через портал в body рисуем fixed-полосу с собственным всегда видимым
 * ползунком (drag + клик по треку), синхронизированным с таблицей.
 */
export function StickyHScroll({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{ startX: number; startScroll: number } | null>(null)
  const [bar, setBar] = useState<BarState | null>(null)

  const update = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) {
      setBar(null)
      return
    }
    const rect = scroller.getBoundingClientRect()
    const vh = window.innerHeight
    const hasOverflow = scroller.scrollWidth > scroller.clientWidth + 1
    // Полоса — у нижнего края окна, но не ниже нижней кромки самой таблицы.
    const top = Math.min(rect.bottom, vh) - BAR_HEIGHT
    if (!hasOverflow || rect.top >= top || rect.bottom <= 0) {
      setBar(null)
      return
    }
    const thumbWidth = Math.max(
      THUMB_MIN_WIDTH,
      (scroller.clientWidth / scroller.scrollWidth) * rect.width,
    )
    const maxScroll = scroller.scrollWidth - scroller.clientWidth
    const maxThumb = rect.width - thumbWidth
    const thumbLeft = maxScroll > 0 ? (scroller.scrollLeft / maxScroll) * maxThumb : 0
    setBar((prev) => {
      const next = { top, left: rect.left, width: rect.width, thumbLeft, thumbWidth }
      if (
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.width === next.width &&
        prev.thumbLeft === next.thumbLeft &&
        prev.thumbWidth === next.thumbWidth
      ) {
        return prev
      }
      return next
    })
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const scroller = wrap.querySelector<HTMLElement>('[data-slot="table-container"]')
    scrollerRef.current = scroller
    if (!scroller) return

    update()
    const ro = new ResizeObserver(update)
    ro.observe(scroller)
    if (scroller.firstElementChild) ro.observe(scroller.firstElementChild)
    scroller.addEventListener("scroll", update, { passive: true })
    // capture: ловим и прокрутку страницы, и вложенных скролл-контейнеров.
    window.addEventListener("scroll", update, { passive: true, capture: true })
    window.addEventListener("resize", update)
    return () => {
      ro.disconnect()
      scroller.removeEventListener("scroll", update)
      window.removeEventListener("scroll", update, { capture: true })
      window.removeEventListener("resize", update)
    }
  }, [update])

  function onThumbPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const scroller = scrollerRef.current
    if (!scroller) return
    dragRef.current = { startX: e.clientX, startScroll: scroller.scrollLeft }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function onThumbPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    const scroller = scrollerRef.current
    if (!drag || !scroller || !bar) return
    const maxThumb = bar.width - bar.thumbWidth
    const maxScroll = scroller.scrollWidth - scroller.clientWidth
    if (maxThumb <= 0) return
    scroller.scrollLeft = drag.startScroll + (e.clientX - drag.startX) * (maxScroll / maxThumb)
  }

  function onThumbPointerUp() {
    dragRef.current = null
  }

  function onTrackPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Клик по самому треку (не по ползунку) — прыжок к месту клика.
    if (e.target !== e.currentTarget) return
    const scroller = scrollerRef.current
    if (!scroller || !bar) return
    const maxScroll = scroller.scrollWidth - scroller.clientWidth
    const ratio = (e.clientX - bar.left - bar.thumbWidth / 2) / (bar.width - bar.thumbWidth)
    scroller.scrollLeft = Math.max(0, Math.min(1, ratio)) * maxScroll
  }

  return (
    <div
      ref={wrapRef}
      className={cn(
        "[&_[data-slot=table-container]]:[scrollbar-width:none] [&_[data-slot=table-container]::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {children}
      {bar &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: bar.top,
              left: bar.left,
              width: bar.width,
              height: BAR_HEIGHT,
              zIndex: 40,
            }}
            className="border-t bg-muted/70 backdrop-blur-sm"
            onPointerDown={onTrackPointerDown}
          >
            <div
              style={{
                position: "absolute",
                top: 2,
                left: bar.thumbLeft,
                width: bar.thumbWidth,
                height: BAR_HEIGHT - 4,
              }}
              className="cursor-grab touch-none rounded-full bg-muted-foreground/50 hover:bg-muted-foreground/70 active:cursor-grabbing"
              onPointerDown={onThumbPointerDown}
              onPointerMove={onThumbPointerMove}
              onPointerUp={onThumbPointerUp}
            />
          </div>,
          document.body,
        )}
    </div>
  )
}
