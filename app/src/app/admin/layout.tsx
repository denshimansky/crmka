"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import {
  BarChart3, Building2, CreditCard, FileText, LayoutDashboard, LogOut, Receipt, Shield, ShieldAlert,
} from "lucide-react"

interface AdminUser {
  adminId: string
  email: string
  name: string
  role: string
}

const navItems = [
  { title: "Дашборд", href: "/admin/dashboard", icon: LayoutDashboard },
  { title: "Партнёры", href: "/admin/partners", icon: Building2 },
  { title: "Тарифы", href: "/admin/plans", icon: CreditCard },
  { title: "Счета", href: "/admin/invoices", icon: Receipt },
  { title: "Аналитика", href: "/admin/analytics", icon: BarChart3 },
  { title: "Лог входов", href: "/admin/login-attempts", icon: ShieldAlert },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (pathname === "/admin/login") {
      setLoading(false)
      return
    }

    fetch("/api/admin/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.admin) {
          setAdmin(data.admin)
        } else {
          router.push("/admin/login")
        }
      })
      .catch(() => router.push("/admin/login"))
      .finally(() => setLoading(false))
  }, [pathname, router])

  if (pathname === "/admin/login") {
    return <>{children}</>
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Загрузка...</div>
      </div>
    )
  }

  if (!admin) return null

  const handleLogout = async () => {
    await fetch("/api/admin/auth", { method: "DELETE" })
    router.push("/admin/login")
  }

  const isActive = (href: string) => pathname.startsWith(href)

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r bg-muted/30">
        <div className="flex items-center gap-2 border-b p-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-orange-600 text-white">
            <Shield className="size-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Бэк-офис</span>
            <span className="text-xs text-muted-foreground">Умная CRM</span>
          </div>
        </div>

        <nav className="flex-1 p-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive(item.href)
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <item.icon className="size-4" />
              {item.title}
            </Link>
          ))}
        </nav>

        <div className="border-t p-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-medium">{admin.name}</span>
              <span className="text-xs text-muted-foreground">{admin.role}</span>
            </div>
            <button onClick={handleLogout} title="Выйти" className="text-muted-foreground hover:text-destructive">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
