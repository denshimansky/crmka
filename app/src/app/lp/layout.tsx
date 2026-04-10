import type { Metadata } from "next"
import { Sparkles } from "lucide-react"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Умная CRM — CRM для детских центров и сферы услуг",
  description: "Управление клиентами, расписанием, абонементами, финансами и персоналом. Замена 1С для детских центров, студий и школ.",
  openGraph: {
    title: "Умная CRM — управление детским центром",
    description: "CRM-система для детских центров и сферы услуг. Расписание, абонементы, финансы, отчёты — всё в одном.",
  },
}

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/lp" className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <Sparkles className="size-5" />
            </div>
            <span className="text-lg font-bold">Умная CRM</span>
          </Link>
          <nav className="hidden sm:flex items-center gap-6 text-sm">
            <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors">Возможности</a>
            <a href="#pricing" className="text-muted-foreground hover:text-foreground transition-colors">Тарифы</a>
            <a href="#faq" className="text-muted-foreground hover:text-foreground transition-colors">Вопросы</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Войти
            </Link>
            <a href="#cta" className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors">
              Попробовать
            </a>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t bg-gray-50 py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-sm">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex size-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
                  <Sparkles className="size-3.5" />
                </div>
                <span className="font-semibold">Умная CRM</span>
              </div>
              <p className="text-muted-foreground">CRM для детских центров и сферы услуг</p>
            </div>
            <div>
              <h4 className="font-medium mb-3">Продукт</h4>
              <ul className="space-y-2 text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground">Возможности</a></li>
                <li><a href="#pricing" className="hover:text-foreground">Тарифы</a></li>
                <li><Link href="/offer" className="hover:text-foreground">Оферта</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-3">Контакты</h4>
              <ul className="space-y-2 text-muted-foreground">
                <li>info@umnayacrm.ru</li>
                <li>Telegram: @umnayacrm</li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Умная CRM &mdash; ИП Шиманский Д.В.
          </div>
        </div>
      </footer>
    </div>
  )
}
