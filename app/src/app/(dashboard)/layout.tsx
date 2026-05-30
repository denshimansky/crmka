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
import { db } from "@/lib/db"
import { hasPermission, PERMISSIONS, type PermissionKey, type RolePermissions } from "@/lib/permissions"
import { requiredPermissionForPath } from "@/lib/route-permissions"
import { AccessDenied } from "@/components/access-denied"

const BILLING_ONLY_ROLES = new Set(["owner", "manager"])

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  const role = session.user.role
  const tenantId = session.user.tenantId
  const headerStore = await headers()
  const pathname = headerStore.get("x-pathname") || "/"

  // Загружаем кастомизированную матрицу прав ровно один раз — нужна и гарду, и сайдбару.
  let orgPerms: RolePermissions | null = null
  if (role !== "owner") {
    const org = await db.organization.findUnique({
      where: { id: tenantId },
      select: { rolePermissions: true },
    })
    orgPerms = (org?.rolePermissions as RolePermissions | null) ?? null
  }

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
    } else {
      const required = requiredPermissionForPath(pathname)
      if (required && !effectivePermissions[required]) {
        denied = true
      }
    }
  }

  return (
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
        <main className="min-w-0 flex-1 overflow-x-hidden p-3 md:p-6">
          {denied ? <AccessDenied /> : children}
        </main>
      </SidebarInset>
      <PageTracking />
      <AiChat />
    </SidebarProvider>
  )
}
