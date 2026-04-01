"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { signOut } from "next-auth/react"
import {
  LayoutDashboard, Users, Filter, Phone, Calendar, CreditCard, Receipt,
  Landmark, ArrowDownUp, AlertTriangle, Wallet, Package, ClipboardList, BarChart3,
  UserCog, Settings, Bell, Sparkles, ChevronDown, LogOut, Map, FileText, Crown,
} from "lucide-react"
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel,
  SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarHeader, SidebarFooter, SidebarSeparator,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import type { Role } from "@prisma/client"

const ROLE_LABELS: Record<Role, string> = {
  owner: "Владелец",
  manager: "Управляющий",
  admin: "Администратор",
  instructor: "Инструктор",
  readonly: "Только чтение",
}

const navItems = [
  { title: "Главная", href: "/", icon: LayoutDashboard },
]

const crmItems = [
  { title: "Лиды", href: "/crm/leads", icon: Filter },
  { title: "Клиенты", href: "/crm/clients", icon: Users },
  { title: "Обзвон", href: "/crm/calls", icon: Phone },
]

const financeItems = [
  { title: "Оплаты", href: "/finance/payments", icon: CreditCard },
  { title: "Расходы", href: "/finance/expenses", icon: Receipt },
  { title: "Касса", href: "/finance/cash", icon: Landmark },
  { title: "ДДС", href: "/finance/dds", icon: ArrowDownUp },
  { title: "Должники", href: "/finance/debtors", icon: AlertTriangle },
]

const otherItems = [
  { title: "Расписание", href: "/schedule", icon: Calendar },
  { title: "Зарплата", href: "/salary", icon: Wallet },
  { title: "Склад", href: "/stock", icon: Package },
  { title: "Задачи", href: "/tasks", icon: ClipboardList },
  { title: "Отчёты", href: "/reports", icon: BarChart3 },
  { title: "Сотрудники", href: "/staff", icon: UserCog },
  { title: "Настройки", href: "/settings", icon: Settings },
  { title: "Roadmap", href: "/roadmap", icon: Map },
  { title: "Changelog", href: "/changelog", icon: FileText },
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

export function AppSidebar() {
  const pathname = usePathname()
  const { data: session, status } = useSession()

  const user = session?.user as
    | { name?: string | null; role?: Role; orgName?: string }
    | undefined

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname.startsWith(href)
  }

  const renderItems = (items: typeof navItems) =>
    items.map((item) => (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton render={<Link href={item.href} />} isActive={isActive(item.href)}>
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
        <button className="mt-2 flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
          <span>Все филиалы</span>
          <ChevronDown className="size-3" />
        </button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>{renderItems(navItems)}</SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>CRM</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(crmItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Финансы</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(financeItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(otherItems)}</SidebarMenu>
            {(user?.role === "owner" || user?.role === "manager") && (
              <>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton render={<Link href="/billing" />} isActive={isActive("/billing")}>
                      <Crown className="size-4" />
                      <span>Подписка</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </>
            )}
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
            <button className="relative">
              <Bell className="size-4 text-muted-foreground" />
              <Badge className="absolute -right-2 -top-2 size-4 justify-center p-0 text-[10px]" variant="destructive">3</Badge>
            </button>
            <button onClick={() => signOut({ callbackUrl: "/login" })} title="Выйти">
              <LogOut className="size-4 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
