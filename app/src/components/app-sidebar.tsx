"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard, Users, Filter, Phone, Calendar, CreditCard, Receipt,
  Landmark, ArrowDownUp, Wallet, Package, ClipboardList, BarChart3,
  UserCog, Settings, Bell, Sparkles, ChevronDown,
} from "lucide-react"
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel,
  SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarHeader, SidebarFooter, SidebarSeparator,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"

const navItems = [
  { title: "Главная", href: "/", icon: LayoutDashboard },
]

const crmItems = [
  { title: "Воронка", href: "/crm/funnel", icon: Filter },
  { title: "Клиенты", href: "/crm/clients", icon: Users },
  { title: "Обзвон", href: "/crm/calls", icon: Phone },
]

const financeItems = [
  { title: "Оплаты", href: "/finance/payments", icon: CreditCard },
  { title: "Расходы", href: "/finance/expenses", icon: Receipt },
  { title: "Касса", href: "/finance/cash", icon: Landmark },
  { title: "ДДС", href: "/finance/dds", icon: ArrowDownUp },
]

const otherItems = [
  { title: "Расписание", href: "/schedule", icon: Calendar },
  { title: "Зарплата", href: "/salary", icon: Wallet },
  { title: "Склад", href: "/stock", icon: Package },
  { title: "Задачи", href: "/tasks", icon: ClipboardList },
  { title: "Отчёты", href: "/reports", icon: BarChart3 },
  { title: "Сотрудники", href: "/staff", icon: UserCog },
  { title: "Настройки", href: "/settings", icon: Settings },
]

export function AppSidebar() {
  const pathname = usePathname()

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
            <span className="text-xs text-muted-foreground">Детский центр «Радуга»</span>
          </div>
        </div>
        <button className="mt-2 flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
          <span>Филиал на Ленина</span>
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
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">ДШ</AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-medium">Денис Ш.</span>
            <span className="text-xs text-muted-foreground">Владелец</span>
          </div>
          <button className="relative">
            <Bell className="size-4 text-muted-foreground" />
            <Badge className="absolute -right-2 -top-2 size-4 justify-center p-0 text-[10px]" variant="destructive">3</Badge>
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
