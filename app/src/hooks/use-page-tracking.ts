"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

/**
 * Трекает просмотры страниц: при переходе отправляет path,
 * при уходе — duration (секунды на странице).
 */
export function usePageTracking() {
  const pathname = usePathname()
  const startRef = useRef(Date.now())
  const lastPathRef = useRef(pathname)

  useEffect(() => {
    // Отправляем просмотр текущей страницы
    sendPageView(pathname)
    startRef.current = Date.now()
    lastPathRef.current = pathname

    // При уходе со страницы — отправляем duration
    return () => {
      const duration = Math.round((Date.now() - startRef.current) / 1000)
      if (duration > 0 && duration < 3600) {
        sendPageView(lastPathRef.current, duration)
      }
    }
  }, [pathname])
}

function sendPageView(path: string, duration?: number) {
  try {
    const body: Record<string, unknown> = { path }
    if (duration !== undefined) body.duration = duration
    // navigator.sendBeacon для надёжности при закрытии вкладки
    if (duration && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(
        "/api/analytics/pageview",
        new Blob([JSON.stringify(body)], { type: "application/json" })
      )
    } else {
      fetch("/api/analytics/pageview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {})
    }
  } catch {
    // аналитика не должна ломать приложение
  }
}
