"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import { usePortalNav } from "./use-portal-nav"

// Нижняя навигация кабинета — только мобилка (на ПК её заменяет верхняя панель).

interface Props {
  slug: string
  defaultWardKey: string | null
}

export function BottomNav({ slug, defaultWardKey }: Props) {
  const items = usePortalNav(slug, defaultWardKey)

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-md">
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className={cn(
              "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs",
              item.active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <item.icon className="size-5" />
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
