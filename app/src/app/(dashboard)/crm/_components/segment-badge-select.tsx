"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronDown, Loader2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SEGMENT_LABELS,
  SEGMENT_ORDER,
  effectiveSegment,
  type ClientSegmentKey,
} from "@/lib/segmentation"

const SEGMENT_COLORS: Record<ClientSegmentKey, string> = {
  new_client: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  standard: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  regular: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  vip: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
}

/**
 * Кликабельный бейдж сегмента в шапке карточки активного клиента (баг #26).
 * Сегмент обычно считается автоматически (по Настройкам сегментации), но после
 * импорта базы метрика ≈ 0 и все выглядят «Новый» — здесь его можно задать
 * вручную. «Авто» сбрасывает ручной выбор к авто-расчёту.
 */
export function SegmentBadgeSelect({
  clientId,
  override,
  computed,
}: {
  clientId: string
  /** Текущее ручное переопределение (Client.segmentOverride) или null. */
  override: ClientSegmentKey | null
  /** Авто-сегмент по настройкам — показывается в пункте «Авто». */
  computed: ClientSegmentKey
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const current = effectiveSegment(override, computed)

  async function setSegment(value: ClientSegmentKey | null) {
    // value === current override и так — ничего не делаем (но «Авто» при наличии
    // override всё равно нужно применить, поэтому сравниваем именно с override).
    if (value === override) return
    setLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segmentOverride: value }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Не удалось сменить сегмент")
      }
    } catch {
      alert("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={loading}
        title="Сменить сегмент"
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium outline-none transition hover:opacity-80 disabled:opacity-50 ${SEGMENT_COLORS[current]}`}
      >
        {SEGMENT_LABELS[current]}
        {loading ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <ChevronDown className="size-3 opacity-70" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {/* Base UI требует, чтобы GroupLabel был внутри Menu.Group — иначе при
            открытии меню падает ошибка #31 (MenuGroupRootContext is missing),
            и карточка активного клиента крашится при клике по бейджу (баг #49). */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Сегмент клиента</DropdownMenuLabel>
          {SEGMENT_ORDER.map((key) => (
            <DropdownMenuItem
              key={key}
              onClick={() => setSegment(key)}
              className="justify-between"
            >
              {SEGMENT_LABELS[key]}
              {override === key && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setSegment(null)} className="justify-between">
          <span>
            Авто{" "}
            <span className="text-muted-foreground">
              ({SEGMENT_LABELS[computed]})
            </span>
          </span>
          {override === null && <Check className="size-4" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
