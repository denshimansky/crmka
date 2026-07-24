"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { LogOut } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePortalNav } from "./use-portal-nav"

interface Props {
  slug: string
  orgName: string
  clientName: string
  defaultWardKey: string | null
}

// Шапка кабинета: на мобилке — название центра + родитель + «Выйти» (навигация
// живёт в нижних вкладках). На ПК разворачивается в полноширинную верхнюю панель
// с горизонтальной навигацией и именем родителя справа.
export function PortalHeader({ slug, orgName, clientName, defaultWardKey }: Props) {
  const router = useRouter()
  const nav = usePortalNav(slug, defaultWardKey)

  async function logout() {
    await fetch("/api/portal/auth", { method: "DELETE" })
    router.push(`/p/${slug}`)
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-md items-center gap-3 px-4 md:h-16 md:max-w-4xl">
        {/* Центр + родитель (при нехватке места сжимается и обрезается первым) */}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight md:text-base">{orgName}</div>
          <div className="truncate text-xs leading-tight text-muted-foreground md:hidden">
            {clientName}
          </div>
        </div>

        {/* Горизонтальная навигация — только ПК */}
        <nav className="ml-2 hidden shrink-0 items-center gap-1 md:flex">
          {nav.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                item.active
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Правый край: имя родителя (ПК) + выход */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="hidden max-w-[200px] truncate text-sm text-muted-foreground lg:inline">
            {clientName}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            title="Выйти"
            className="size-10 shrink-0"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </header>
  )
}
