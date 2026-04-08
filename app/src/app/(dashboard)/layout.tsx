import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { BillingBanner } from "@/components/billing-banner"
import { AiChat } from "@/components/ai-chat"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 items-center gap-4 border-b px-6">
          <SidebarTrigger />
        </header>
        <BillingBanner />
        <main className="flex-1 p-6">
          {children}
        </main>
      </SidebarInset>
      <AiChat />
    </SidebarProvider>
  )
}
