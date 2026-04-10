import type { Metadata } from "next"
import Link from "next/link"
import { ClipboardCheck } from "lucide-react"

export const metadata: Metadata = {
  title: "Тест-кейсы — Умная CRM",
}

export default function TestingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <ClipboardCheck className="size-5 text-indigo-600" />
            <span className="font-bold">Тест-кейсы</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/dev" className="text-muted-foreground hover:text-foreground">Dev</Link>
            <Link href="/login" className="text-muted-foreground hover:text-foreground">Войти</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
