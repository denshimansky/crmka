import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { BillingBanner } from "@/components/billing-banner"
import { ImpersonationBanner } from "@/components/impersonation-banner"
import { AiChat } from "@/components/ai-chat"
import { PageTracking } from "@/components/page-tracking"
import { AutoBreadcrumbs } from "@/components/auto-breadcrumbs"
import { Separator } from "@/components/ui/separator"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 items-center gap-4 border-b px-3 md:px-6">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <AutoBreadcrumbs />
        </header>
        <ImpersonationBanner />
        <BillingBanner />
        <main className="min-w-0 flex-1 overflow-x-hidden p-3 md:p-6">
          {children}
        </main>
      </SidebarInset>
      <PageTracking />
      <AiChat />
    </SidebarProvider>
  )
}
