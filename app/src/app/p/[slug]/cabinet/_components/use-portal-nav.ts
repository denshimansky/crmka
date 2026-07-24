"use client"

import { usePathname } from "next/navigation"
import { Home, ClipboardCheck, History, CreditCard, type LucideIcon } from "lucide-react"

// Пункты навигации кабинета родителя — общие для нижних вкладок (мобилка) и
// верхней панели (ПК). Разделы «Главная/Посещения/История» живут в разрезе
// подопечного: текущий wardId берём из pathname, иначе — дефолтный.

export interface PortalNavItem {
  href: string
  label: string
  icon: LucideIcon
  active: boolean
}

export function usePortalNav(slug: string, defaultWardKey: string | null): PortalNavItem[] {
  const pathname = usePathname()
  const base = `/p/${slug}/cabinet`

  const wardMatch = pathname.match(/\/cabinet\/w\/([^/]+)/)
  const wardKey = wardMatch?.[1] || defaultWardKey

  return [
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
}
