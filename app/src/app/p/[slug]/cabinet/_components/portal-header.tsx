"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { LogOut } from "lucide-react"

interface Props {
  slug: string
  orgName: string
  clientName: string
}

export function PortalHeader({ slug, orgName, clientName }: Props) {
  const router = useRouter()

  async function logout() {
    await fetch("/api/portal/auth", { method: "DELETE" })
    router.push(`/p/${slug}`)
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-10 -mx-4 mb-4 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{orgName}</div>
        <div className="truncate text-xs text-muted-foreground">{clientName}</div>
      </div>
      <Button variant="ghost" size="icon" onClick={logout} title="Выйти" className="size-11 shrink-0">
        <LogOut className="size-4" />
      </Button>
    </header>
  )
}
