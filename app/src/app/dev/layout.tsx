import { Sparkles } from "lucide-react"
import Link from "next/link"

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/dev" className="flex items-center gap-2 hover:opacity-80">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </div>
            <span className="text-sm font-semibold">Умная CRM</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/roadmap" className="text-sm text-muted-foreground hover:text-foreground">
              Roadmap
            </Link>
            <Link href="/changelog" className="text-sm text-muted-foreground hover:text-foreground">
              Changelog
            </Link>
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
              Войти
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {children}
      </main>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        <div className="mx-auto max-w-5xl px-4">
          &copy; {new Date().getFullYear()} Умная CRM &mdash; ИП Шиманский Д.В.
        </div>
      </footer>
    </div>
  )
}
