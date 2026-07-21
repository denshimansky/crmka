import { headers } from "next/headers"
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { BillingBanner } from "@/components/billing-banner"
import { ImpersonationBanner } from "@/components/impersonation-banner"
import { AiChat } from "@/components/ai-chat"
import { PageTracking } from "@/components/page-tracking"
import { AutoBreadcrumbs } from "@/components/auto-breadcrumbs"
import { Separator } from "@/components/ui/separator"
import { getSession } from "@/lib/session"
import { getOrgUiSettings, getRoleNames } from "@/lib/role-names"
import { RoleNamesProvider } from "@/components/role-names-provider"
import { hasPermission, PERMISSIONS, REPORT_PERMISSION_KEYS, type PermissionKey, type RolePermissions } from "@/lib/permissions"
import { requiredPermissionForPath } from "@/lib/route-permissions"
import { AccessDenied } from "@/components/access-denied"

const BILLING_ONLY_ROLES = new Set(["owner", "manager"])

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  const role = session.user.role
  const tenantId = session.user.tenantId
  const headerStore = await headers()
  const pathname = headerStore.get("x-pathname") || "/"

  // Кастомизированная матрица прав и названия ролей — один cached-запрос
  // (getOrgUiSettings) на весь рендер: нужен и гарду, и сайдбару, и провайдеру.
  let orgPerms: RolePermissions | null = null
  if (role !== "owner") {
    const org = await getOrgUiSettings(tenantId)
    orgPerms = (org?.rolePermissions as RolePermissions | null) ?? null
  }

  // Кастомные названия ролей — для сайдбара и всех клиентских компонентов (через контекст)
  const roleNames = await getRoleNames(tenantId)

  // Эффективные права текущей роли (для сайдбара)
  const effectivePermissions: Record<PermissionKey, boolean> = {} as Record<PermissionKey, boolean>
  for (const p of PERMISSIONS) {
    effectivePermissions[p.key] = hasPermission(role, p.key, orgPerms)
  }

  // Owner всегда имеет полный доступ — пропускаем проверку прав
  let denied = false
  if (role !== "owner") {
    // Биллинг: hardcoded — только owner/manager
    if (pathname === "/billing" || pathname.startsWith("/billing/")) {
      if (!BILLING_ONLY_ROLES.has(role)) denied = true
    } else if (pathname === "/reports") {
      // Индекс отчётов (баг #77): доступен при любом праве на блок отчётов;
      // сама страница фильтрует карточки по правам.
      if (!REPORT_PERMISSION_KEYS.some((k) => effectivePermissions[k])) denied = true
    } else {
      const required = requiredPermissionForPath(pathname)
      if (required && !effectivePermissions[required]) {
        denied = true
      }
    }
  }

  return (
    <RoleNamesProvider value={roleNames}>
    <SidebarProvider>
      <AppSidebar permissions={effectivePermissions} />
      <SidebarInset>
        <header className="flex h-14 items-center gap-4 border-b px-3 md:px-6">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <AutoBreadcrumbs />
        </header>
        <ImpersonationBanner />
        <BillingBanner />
        {/* pb-24 — резерв снизу, чтобы плавающая кнопка AI-ассистента (fixed
            bottom-6 right-6, h-14) не перекрывала нижний ряд таблиц/контента на
            любой странице, особенно на небольших экранах (баг #20). */}
        <main className="min-w-0 flex-1 overflow-x-hidden p-3 pb-24 md:p-6 md:pb-24">
          {denied ? <AccessDenied /> : children}
        </main>
      </SidebarInset>
      <PageTracking />
      <AiChat />
    </SidebarProvider>
    </RoleNamesProvider>
  )
}
