"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Bell, Check, CheckCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface Notification {
  id: string
  type: string
  title: string
  message: string
  isRead: boolean
  createdAt: string
  link: string | null
}

const TYPE_COLORS: Record<string, string> = {
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  warning: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  error: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  success: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  task: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return "только что"
  if (diffMin < 60) return `${diffMin} мин. назад`

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours} ч. назад`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays} дн. назад`

  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const unreadCount = notifications.filter(n => !n.isRead).length

  const loadNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/notifications?limit=20")
      if (res.ok) {
        const data = await res.json()
        setNotifications(Array.isArray(data) ? data : data.items || [])
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  // Load on mount and periodically
  useEffect(() => {
    loadNotifications()
    const interval = setInterval(loadNotifications, 60000) // каждую минуту
    return () => clearInterval(interval)
  }, [loadNotifications])

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open])

  async function markAsRead(id: string) {
    try {
      await fetch(`/api/notifications/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      })
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, isRead: true } : n)
      )
    } catch { /* ignore */ }
  }

  async function markAllAsRead() {
    try {
      await fetch("/api/notifications/read-all")
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
    } catch { /* ignore */ }
  }

  function handleNotificationClick(n: Notification) {
    if (!n.isRead) markAsRead(n.id)
    if (n.link) {
      window.location.href = n.link
    }
    setOpen(false)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className="relative"
        onClick={() => {
          setOpen(!open)
          if (!open) loadNotifications()
        }}
      >
        <Bell className="size-4 text-muted-foreground" />
        {unreadCount > 0 && (
          <Badge
            className="absolute -right-2 -top-2 size-4 justify-center p-0 text-[10px]"
            variant="destructive"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </Badge>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-80 rounded-lg border bg-popover shadow-lg z-50">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="text-sm font-semibold">Уведомления</span>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={markAllAsRead}
              >
                <CheckCheck className="mr-1 size-3" />
                Прочитать все
              </Button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Загрузка...
              </p>
            ) : notifications.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Нет уведомлений
              </p>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={`flex cursor-pointer gap-3 border-b px-4 py-3 transition-colors hover:bg-accent last:border-0 ${
                    !n.isRead ? "bg-accent/50" : ""
                  }`}
                  onClick={() => handleNotificationClick(n)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TYPE_COLORS[n.type] || TYPE_COLORS.info}`}>
                        {n.type}
                      </span>
                      {!n.isRead && (
                        <span className="size-1.5 rounded-full bg-blue-500" />
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium leading-tight">
                      {n.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                      {n.message}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {formatTimeAgo(n.createdAt)}
                    </p>
                  </div>
                  {!n.isRead && (
                    <button
                      className="mt-1 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        markAsRead(n.id)
                      }}
                      title="Отметить прочитанным"
                    >
                      <Check className="size-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
