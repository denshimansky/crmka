"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, ClipboardCheck, History, CreditCard } from "lucide-react"
import { cn } from "@/lib/utils"

// Нижняя навигация кабинета. Разделы «Главная/Посещения/История» живут в
// разрезе подопечного — текущий wardId берём из pathname, иначе дефолтный.

interface Props {
  slug: string
  defaultWardKey: string | null
}

export function BottomNav({ slug, defaultWardKey }: Props) {
  const pathname = usePathname()
  const base = `/p/${slug}/cabinet`

  const wardMatch = pathname.match(/\/cabinet\/w\/([^/]+)/)
  const wardKey = wardMatch?.[1] || defaultWardKey

  const items = [
    {
      href: wardKey ? `${base}/w/${wardKey}` : base,
      label: "Главная",
      icon: Home,
      active: /\/cabinet\/w\/[^/]+$/.test(pathname) || pathname === base,
    },
    {
      href: wardKey ? `${base}/w/${wardKey}/visits` : base,
      label: "Посещения",
      icon: ClipboardCheck,
      active: pathname.endsWith("/visits"),
    },
    {
      href: wardKey ? `${base}/w/${wardKey}/history` : base,
      label: "История",
      icon: History,
      active: pathname.endsWith("/history"),
    },
    {
      href: `${base}/payments`,
      label: "Оплаты",
      icon: CreditCard,
      active: pathname.endsWith("/payments"),
    },
  ]

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
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
