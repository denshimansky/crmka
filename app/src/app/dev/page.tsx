import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import {
  Map, FileText, Shield, LogIn, Users, BarChart3,
  Monitor, TestTube, Globe, CreditCard, Sparkles,
} from "lucide-react"

interface NavCard {
  title: string
  description: string
  href: string
  icon: typeof Map
  badge?: string
  badgeVariant?: "default" | "secondary" | "outline" | "destructive"
  external?: boolean
}

const publicPages: NavCard[] = [
  {
    title: "Roadmap",
    description: "Прогресс разработки, модули, фазы до MVP",
    href: "/roadmap",
    icon: Map,
    badge: "100%",
    badgeVariant: "default",
  },
  {
    title: "Changelog",
    description: "История версий и изменений",
    href: "/changelog",
    icon: FileText,
    badge: "v1.5.4",
    badgeVariant: "secondary",
  },
  {
    title: "Оферта",
    description: "Публичная оферта и условия использования",
    href: "/offer",
    icon: Globe,
  },
]

const appPages: NavCard[] = [
  {
    title: "CRM — Вход",
    description: "Основной интерфейс для партнёров",
    href: "/login",
    icon: LogIn,
  },
  {
    title: "Бэк-офис (Admin)",
    description: "Управление партнёрами, тарифами, подписками",
    href: "/admin/login",
    icon: Shield,
    badge: "superadmin",
    badgeVariant: "outline",
  },
  {
    title: "ЛК клиента (Portal)",
    description: "Расписание, баланс, оплаты — для клиентов партнёров",
    href: "/portal",
    icon: Users,
  },
]

const devPages: NavCard[] = [
  {
    title: "Демо-аккаунт",
    description: "demo@test.com / demo123 — полный доступ к CRM",
    href: "/login",
    icon: Monitor,
  },
  {
    title: "API документация",
    description: "159 endpoints — REST API",
    href: "/dev/api",
    icon: BarChart3,
    badge: "159 API",
    badgeVariant: "secondary",
  },
]

const stats = [
  { label: "Страниц", value: "60" },
  { label: "API endpoints", value: "159" },
  { label: "Моделей БД", value: "51" },
  { label: "Тестовых файлов", value: "26" },
  { label: "Строк тестов", value: "9 500" },
  { label: "Компонентов", value: "41" },
]

function NavCardComponent({ card }: { card: NavCard }) {
  return (
    <Link href={card.href}>
      <Card className="h-full transition-colors hover:bg-muted/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <card.icon className="size-5 text-muted-foreground" />
              <CardTitle className="text-base">{card.title}</CardTitle>
            </div>
            {card.badge && (
              <Badge variant={card.badgeVariant || "default"}>{card.badge}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{card.description}</p>
        </CardContent>
      </Card>
    </Link>
  )
}

export default function DevPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Умная CRM</h1>
            <p className="text-sm text-muted-foreground">
              CRM для детских центров и сферы услуг — v1.5.4-alpha
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="px-3 pt-3 pb-3 text-center">
              <p className="text-lg font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Public */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Публичные страницы</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {publicPages.map((card) => (
            <NavCardComponent key={card.href} card={card} />
          ))}
        </div>
      </div>

      {/* App */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Приложение</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {appPages.map((card) => (
            <NavCardComponent key={card.href} card={card} />
          ))}
        </div>
      </div>

      {/* Dev */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Разработка и тесты</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {devPages.map((card) => (
            <NavCardComponent key={card.href} card={card} />
          ))}
        </div>
      </div>

      {/* Tech stack */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Стек</h2>
        <div className="flex flex-wrap gap-2">
          {[
            "Next.js 15", "TypeScript", "Tailwind CSS", "shadcn/ui",
            "Prisma", "PostgreSQL 17", "Docker", "GitHub Actions",
            "Playwright", "PWA",
          ].map((tech) => (
            <Badge key={tech} variant="outline" className="text-xs">{tech}</Badge>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Таймлайн</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-muted-foreground">16 марта</span>
              <span>Старт разработки</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-muted-foreground">31 марта</span>
              <span>10 базовых модулей готовы (v1.0-α)</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-muted-foreground">1 апреля</span>
              <span>Биллинг SaaS + ЛК (v1.4.0)</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-muted-foreground">10 апреля</span>
              <span>70+ доработок, 100% PRD (v1.5.4)</span>
              <Badge variant="default" className="text-xs">Сейчас</Badge>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-muted-foreground">Апрель</span>
              <span className="text-muted-foreground">Пилот с 5 партнёрами</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-muted-foreground">1 июня</span>
              <span className="text-muted-foreground">MVP — запуск</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
