"use client"

import { useSession } from "next-auth/react"
import { ShieldAlert } from "lucide-react"

export function ImpersonationBanner() {
  const { data: session } = useSession()
  const token = session as any
  const impersonatedBy = token?.impersonatedBy || token?.user?.impersonatedBy

  if (!impersonatedBy) return null

  const handleExit = () => {
    // Удалить session cookie и перенаправить в бэкофис
    document.cookie = "next-auth.session-token=; path=/; max-age=0"
    document.cookie = "__Secure-next-auth.session-token=; path=/; max-age=0; secure"
    window.location.href = "/admin/partners"
  }

  return (
    <div className="bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between text-sm font-medium">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4" />
        <span>Режим поддержки — вы вошли как владелец организации ({impersonatedBy})</span>
      </div>
      <button
        onClick={handleExit}
        className="underline hover:no-underline font-semibold"
      >
        Выйти из режима
      </button>
    </div>
  )
}
