import { Sparkles } from "lucide-react"
import Link from "next/link"

/**
 * Каркас публичных страниц браузерного расширения (пока это политика
 * конфиденциальности — /extension/privacy).
 *
 * Копия каркаса оферты, а не общий компонент: страницы юридические, живут
 * своей жизнью, и «улучшение» одной не должно молча менять вид другой.
 * Раздел открыт без авторизации — исключение в matcher middleware: по этой
 * ссылке ходит ревьюер Chrome Web Store, и редирект на /login означал бы отказ
 * в публикации.
 */
export default function ExtensionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b bg-background print:hidden">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </div>
            <span className="text-sm font-semibold">Умная CRM</span>
          </Link>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
            Войти
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 print:py-4 print:max-w-none">{children}</main>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground print:hidden">
        <div className="mx-auto max-w-4xl px-4">
          &copy; {new Date().getFullYear()} Умная CRM &mdash; ИП Шиманский Д.В.
        </div>
      </footer>
    </div>
  )
}
