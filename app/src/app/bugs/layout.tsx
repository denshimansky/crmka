import type { Metadata } from "next"
import Link from "next/link"
import { Bug } from "lucide-react"

export const metadata: Metadata = {
  title: "Баги — Умная CRM",
}

export default function BugsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <Bug className="size-5 text-rose-600" />
            <span className="font-bold">Баг-трекер</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/testing" className="text-muted-foreground hover:text-foreground">Тест-кейсы</Link>
            <Link href="/dev" className="text-muted-foreground hover:text-foreground">Dev</Link>
            <Link href="/login" className="text-muted-foreground hover:text-foreground">Войти</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
