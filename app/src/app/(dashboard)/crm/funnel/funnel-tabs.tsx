"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"

export interface FunnelTab {
  value: string
  label: string
  count: number
}

export function FunnelTabs({
  tabs,
  current,
}: {
  tabs: FunnelTab[]
  current: string
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function buildHref(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set("status", value)
    else params.delete("status")
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b">
      {tabs.map((tab) => {
        const active = (current || "") === tab.value
        return (
          <Link
            key={tab.value || "all"}
            href={buildHref(tab.value)}
            scroll={false}
            className={cn(
              "relative px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "text-foreground after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            <span
              className={cn(
                "ml-1.5 text-xs",
                active ? "text-muted-foreground" : "text-muted-foreground/70"
              )}
            >
              {tab.count}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
