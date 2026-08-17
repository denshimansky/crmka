"use client"

import { useSession } from "next-auth/react"
import { ShieldAlert } from "lucide-react"
import { DEFAULT_ROLE_DISPLAY_NAMES } from "@/lib/roles"

export function ImpersonationBanner() {
  const { data: session } = useSession()
  const token = session as any
  const impersonatedBy = token?.impersonatedBy || token?.user?.impersonatedBy

  if (!impersonatedBy) return null

  // Под кем вошли — имя и роль сотрудника (не всегда владелец).
  const name = token?.user?.name as string | undefined
  const role = token?.user?.role as keyof typeof DEFAULT_ROLE_DISPLAY_NAMES | undefined
  const roleLabel = role ? DEFAULT_ROLE_DISPLAY_NAMES[role] || role : ""
  const asWhom = name
    ? `${name}${roleLabel ? ` · ${roleLabel}` : ""}`
    : "сотрудник организации"

  const handleExit = () => {
    // Удалить session cookie и перенаправить в бэкофис
    document.cookie = "next-auth.session-token=; path=/; max-age=0"
    document.cookie = "__Secure-next-auth.session-token=; path=/; max-age=0; secure"
    window.location.href = "/admin/partners"
  }

  return (
    <div className="bg-amber-500 text-amber-950 px-4 py-2 flex flex-wrap items-center justify-between gap-y-1 text-sm font-medium">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4" />
        <span>Режим поддержки — вы вошли как {asWhom} (админ: {impersonatedBy})</span>
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
