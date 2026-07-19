"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

// Переключатель подопечных: chips с горизонтальным скроллом; при переключении
// сохраняется текущий раздел (посещения/история).

interface Props {
  slug: string
  chips: { key: string; label: string }[]
}

export function WardSwitcher({ slug, chips }: Props) {
  const pathname = usePathname()
  const match = pathname.match(/\/cabinet\/w\/([^/]+)(\/(?:visits|history))?/)
  const activeKey = match?.[1]
  const section = match?.[2] || ""

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={`/p/${slug}/cabinet/w/${chip.key}${section}`}
          className={cn(
            "flex h-9 shrink-0 items-center rounded-full border px-4 text-sm font-medium",
            chip.key === activeKey
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-background text-foreground"
          )}
        >
          {chip.label}
        </Link>
      ))}
    </div>
  )
}
