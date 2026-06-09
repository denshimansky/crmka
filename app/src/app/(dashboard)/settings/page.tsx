import { getSession } from "@/lib/session"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Building2,
  MapPin,
  Megaphone,
  Palette,
  Shield,
  UserX,
  CalendarDays,
  ListChecks,
  Bell,
  UserCog,
  Landmark,
  ArrowDownUp,
  LogOut,
  Layers,
  Info,
  Sliders,
  Tag,
  Gift,
  Upload,
  Crown,
  Plug,
  Target,
} from "lucide-react"
import Link from "next/link"
import { PageHelp } from "@/components/page-help"

interface Tile {
  href: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  /** Подсветка для «системных» плиток (Параметры системы, Абонементы) */
  accent?: boolean
  /** Скрываем, если false */
  show?: boolean
}

export default async function SettingsPage() {
  const session = await getSession()
  const isOwner = session.user.role === "owner"
  const isOwnerOrManager = isOwner || session.user.role === "manager"

  const orgTiles: Tile[] = [
    {
      href: "/settings/organization",
      title: "Информация об организации",
      description: "Название, юрлицо, ИНН, контакты",
      icon: Info,
    },
    {
      href: "/settings/branches",
      title: "Филиалы",
      description: "Адреса, залы, время работы",
      icon: Building2,
    },
    {
      href: "/settings/directions",
      title: "Направления",
      description: "Услуги центра, цены и длительности занятий",
      icon: MapPin,
    },
    {
      href: "/settings/role-permissions",
      title: "Права ролей",
      description: "Что видят и могут делать сотрудники по ролям",
      icon: Shield,
    },
    {
      href: "/settings/production-calendar",
      title: "Производственный календарь",
      description: "Праздничные и выходные дни — пропускаются при генерации",
      icon: CalendarDays,
    },
    {
      href: "/settings/tasks",
      title: "Автотриггеры задач",
      description: "Какие задачи создаются автоматически и с какой даты",
      icon: Bell,
    },
    {
      href: "/settings/system",
      title: "Параметры системы",
      description: "Оплата прогула/пробных, дедлайны, лимит долга, дни выплат ЗП",
      icon: Sliders,
      accent: true,
    },
    {
      href: "/settings/subscription-model",
      title: "Абонементы (модель + автозакрытие)",
      description: "Тип работы с абонементами и срок автозакрытия неоплаченных",
      icon: Tag,
      accent: true,
    },
  ]

  const personalTiles: Tile[] = [
    {
      href: "/settings/admin-bonus",
      title: "Бонусы админов",
      description: "Вознаграждения за пробные, продажи и допродажи",
      icon: Gift,
    },
    {
      href: "/settings/withdrawal-reasons",
      title: "Причины отчисления",
      description: "Обязательный справочник при отчислении ученика",
      icon: LogOut,
    },
    {
      href: "/settings/finance-categories",
      title: "Статьи доходов и расходов",
      description: "Категории для ДДС и ОПИУ: аренда, реклама, проценты банка",
      icon: ArrowDownUp,
    },
    {
      href: "/staff",
      title: "Сотрудники",
      description: "Учётные записи, роли, ставки ЗП, филиалы и контакты",
      icon: UserCog,
    },
    {
      href: "/finance/cash",
      title: "Касса",
      description: "Счета: наличные, расчётный, эквайринг, онлайн — балансы",
      icon: Landmark,
    },
    {
      href: "/settings/absence-reasons",
      title: "Причины пропусков",
      description: "Болезнь, отпуск, погода и другие причины отсутствия",
      icon: UserX,
    },
    {
      href: "/settings/attendance-matrix",
      title: "Виды посещений",
      description: "Матрица статусов «Тип дня»: списания, ЗП, проценты",
      icon: ListChecks,
    },
    {
      href: "/settings/channels",
      title: "Каналы привлечения",
      description: "Откуда приходят клиенты: сайт, соцсети, рекомендация",
      icon: Megaphone,
    },
    {
      href: "/settings/discount-templates",
      title: "Шаблоны скидок",
      description: "Готовые шаблоны для быстрого применения скидок",
      icon: Palette,
    },
    {
      href: "/settings/segmentation",
      title: "Сегментация клиентов",
      description: "Пороги «Новый/Стандартный/Постоянный/VIP» по сумме или времени",
      icon: Layers,
    },
    {
      href: "/settings/leads-import",
      title: "Импорт базы",
      description: "Миграция базы клиентов из 1С и синхронизация остатков",
      icon: Upload,
      show: isOwner,
    },
    {
      href: "/finance/planned-expenses",
      title: "Плановые расходы",
      description: "План vs факт по статьям расходов: контроль бюджета",
      icon: Target,
    },
    {
      href: "/settings/integrations",
      title: "Интеграции",
      description: "Подключение внешних сервисов — почта, телефония, платёжки",
      icon: Plug,
    },
    {
      href: "/billing",
      title: "Подписка",
      description: "Тариф «Умной CRM», счета и оплата от партнёра",
      icon: Crown,
      show: isOwnerOrManager,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Настройки</h1>
        <PageHelp pageKey="settings" />
      </div>

      <Tabs defaultValue="org">
        <TabsList>
          <TabsTrigger value="org">Организация</TabsTrigger>
          <TabsTrigger value="personnel">Персональные</TabsTrigger>
        </TabsList>

        <TabsContent value="org">
          <TileGrid tiles={orgTiles} />
        </TabsContent>

        <TabsContent value="personnel">
          <TileGrid tiles={personalTiles} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function TileGrid({ tiles }: { tiles: Tile[] }) {
  const visible = tiles.filter((t) => t.show !== false)
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {visible.map((t) => {
        const Icon = t.icon
        return (
          <Link key={t.href} href={t.href} className="block">
            <Card
              className={
                "h-full transition-colors hover:border-primary/50 " +
                (t.accent ? "bg-amber-50/60 dark:bg-amber-950/20" : "")
              }
            >
              <CardContent className="flex items-start gap-3 p-5">
                <div
                  className={
                    "flex size-10 shrink-0 items-center justify-center rounded-lg " +
                    (t.accent
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      : "bg-primary/10 text-primary")
                  }
                >
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-medium leading-tight">{t.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        )
      })}
    </div>
  )
}
