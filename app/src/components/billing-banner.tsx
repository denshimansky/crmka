"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { AlertTriangle, Ban } from "lucide-react"

type BillingInfo = {
  billingStatus: string
  daysUntilPayment?: number
} | null

export function BillingBanner() {
  const [info, setInfo] = useState<BillingInfo>(null)
  const pathname = usePathname()
  const { data: session } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role

  useEffect(() => {
    const load = () =>
      fetch("/api/billing-status")
        .then((r) => (r.ok ? r.json() : null))
        .then(setInfo)
        .catch(() => null)
    load()
    // Живое обновление: плашка появляется/исчезает без перезагрузки
    // (enforcement в middleware идёт по JWT и запаздывает до 5 минут)
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [])

  if (!info) return null

  if (info.billingStatus === "blocked") {
    return (
      <div className="sticky top-0 z-40 flex flex-wrap items-center gap-2 bg-destructive px-4 py-2 text-destructive-foreground text-sm">
        <Ban className="size-4 shrink-0" />
        <span className="font-medium">Счёт не оплачен — CRM в режиме просмотра.</span>
        <span>Любые изменения недоступны до оплаты.</span>
        {role === "owner" || role === "manager" ? (
          pathname !== "/billing" && (
            <Link href="/billing" className="font-medium underline underline-offset-2">
              Перейти к оплате →
            </Link>
          )
        ) : (
          <span>Обратитесь к владельцу организации.</span>
        )}
      </div>
    )
  }

  if (info.billingStatus === "grace_period") {
    return (
      <div className="flex items-center gap-2 rounded-md bg-yellow-500/15 border border-yellow-500/30 px-4 py-2 text-yellow-700 dark:text-yellow-400 text-sm">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="font-medium">Грейс-период.</span>
        <span>Срок оплаты истёк. Оплатите счёт, чтобы избежать блокировки.</span>
      </div>
    )
  }

  // Предупреждение за 5 дней
  if (info.daysUntilPayment !== undefined && info.daysUntilPayment <= 5 && info.daysUntilPayment >= 0) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-blue-500/10 border border-blue-500/20 px-4 py-2 text-blue-700 dark:text-blue-400 text-sm">
        <AlertTriangle className="size-4 shrink-0" />
        <span>Оплата подписки через {info.daysUntilPayment} {info.daysUntilPayment === 1 ? "день" : info.daysUntilPayment <= 4 ? "дня" : "дней"}.</span>
      </div>
    )
  }

  return null
}
