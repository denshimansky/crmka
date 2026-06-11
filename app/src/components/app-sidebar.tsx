"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { signOut } from "next-auth/react"
import {
  LayoutDashboard, Users, Filter, Phone, Calendar, CreditCard, Receipt,
  ArrowDownUp, AlertTriangle, Wallet, Package, ClipboardList, BarChart3,
  Settings, Sparkles, LogOut,
  Baby, Ticket, ClipboardCheck, Banknote,
} from "lucide-react"
import { NotificationBell } from "@/components/notification-bell"
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel,
  SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarHeader, SidebarFooter, SidebarSeparator, useSidebar,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import type { Role } from "@prisma/client"
import type { PermissionKey } from "@/lib/permissions"

const ROLE_LABELS: Record<Role, string> = {
  owner: "Владелец",
  manager: "Управляющий",
  admin: "Администратор",
  instructor: "Инструктор",
  readonly: "Только чтение",
}

interface NavItem {
  title: string
  href: string
  icon: typeof LayoutDashboard
  permission?: PermissionKey
}

const navItems: NavItem[] = [
  { title: "Дашборд", href: "/", icon: LayoutDashboard },
]

const crmItems: NavItem[] = [
  { title: "Клиенты", href: "/crm/contacts", icon: Users, permission: "clients.view" },
  { title: "Продажи", href: "/crm/sales", icon: Filter, permission: "clients.view" },
  { title: "Дети", href: "/crm/children", icon: Baby, permission: "clients.view" },
  { title: "Абонементы", href: "/crm/subscriptions", icon: Ticket, permission: "clients.view" },
  { title: "Обзвон", href: "/crm/calls", icon: Phone, permission: "clients.view" },
]

const financeItems: NavItem[] = [
  { title: "Касса", href: "/finance/cash", icon: Banknote, permission: "finance.view" },
  { title: "Оплаты", href: "/finance/payments", icon: CreditCard, permission: "finance.view" },
  { title: "Расходы", href: "/finance/expenses", icon: Receipt, permission: "finance.view" },
  { title: "ДДС", href: "/finance/dds", icon: ArrowDownUp, permission: "finance.result" },
  { title: "Должники", href: "/finance/debtors", icon: AlertTriangle, permission: "finance.view" },
]

// «Плановые расходы», «Интеграции» и «Подписка» перенесены в Настройки →
// вкладку «Персональные» — здесь не дублируем.
const otherItems: NavItem[] = [
  { title: "Расписание", href: "/schedule", icon: Calendar, permission: "schedule.view" },
  { title: "Занятия", href: "/lessons", icon: ClipboardCheck, permission: "schedule.view" },
  { title: "Зарплата", href: "/salary", icon: Wallet, permission: "finance.salary" },
  { title: "Склад", href: "/stock", icon: Package, permission: "schedule.view" },
  { title: "Задачи", href: "/tasks", icon: ClipboardList, permission: "clients.view" },
  { title: "Отчёты", href: "/reports", icon: BarChart3, permission: "reports.view" },
  { title: "Настройки", href: "/settings", icon: Settings, permission: "settings.view" },
]

function getInitials(name: string | null | undefined): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

function getShortName(name: string | null | undefined): string {
  if (!name) return "---"
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1][0]}.`
  }
  return name
}

export function AppSidebar({
  permissions,
}: {
  permissions: Record<PermissionKey, boolean>
}) {
  const pathname = usePathname()
  const { data: session, status } = useSession()
  const { isMobile, setOpenMobile } = useSidebar()

  const user = session?.user as
    | { name?: string | null; role?: Role; orgName?: string }
    | undefined

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname.startsWith(href)
  }

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false)
  }

  const filterByPerm = (items: NavItem[]) =>
    items.filter((i) => !i.permission || permissions[i.permission])

  // Инструктору «Дашборд» не показываем — у него главная без виджетов.
  const visibleNavItems = filterByPerm(navItems).filter(
    (i) => !(user?.role === "instructor" && i.href === "/"),
  )
  const visibleCrmItems = filterByPerm(crmItems)
  const visibleFinanceItems = filterByPerm(financeItems)
  const visibleOtherItems = filterByPerm(otherItems)

  const renderItems = (items: NavItem[]) =>
    items.map((item) => (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton render={<Link href={item.href} onClick={handleNavClick} />} isActive={isActive(item.href)}>
          <item.icon className="size-4" />
          <span>{item.title}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ))

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Умная CRM</span>
            {status === "loading" ? (
              <Skeleton className="mt-0.5 h-3 w-32" />
            ) : (
              <span className="text-xs text-muted-foreground">
                {user?.orgName || "---"}
              </span>
            )}
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="overflow-x-hidden overscroll-contain touch-pan-y">
        <SidebarGroup>
          <SidebarMenu>{renderItems(visibleNavItems)}</SidebarMenu>
        </SidebarGroup>

        {visibleCrmItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>CRM</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(visibleCrmItems)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {visibleFinanceItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Финансы</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(visibleFinanceItems)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(visibleOtherItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4">
        {status === "loading" ? (
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              <AvatarFallback className="text-xs">
                {getInitials(user?.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-1 flex-col">
              <span className="text-sm font-medium">
                {getShortName(user?.name)}
              </span>
              <span className="text-xs text-muted-foreground">
                {user?.role ? ROLE_LABELS[user.role] : "---"}
              </span>
            </div>
            <NotificationBell />
            <button onClick={() => signOut({ callbackUrl: "/login" })} title="Выйти">
              <LogOut className="size-4 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
