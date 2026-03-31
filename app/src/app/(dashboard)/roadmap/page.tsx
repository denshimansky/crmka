import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CheckCircle2, Circle, Clock, Rocket, Calendar, CreditCard, BarChart3, Bell, Users, Globe } from "lucide-react"

type ModuleStatus = "done" | "in_progress" | "planned" | "future"

interface Module {
  id: number
  name: string
  description: string
  status: ModuleStatus
  version: string
  date?: string
  features: string[]
  icon: typeof Rocket
}

const modules: Module[] = [
  {
    id: 1,
    name: "Авторизация и мультитенант",
    description: "Логин, роли, JWT-сессии, middleware, изоляция данных",
    status: "done",
    version: "v0.2.0",
    date: "25.03.2026",
    features: ["Логин/пароль", "5 ролей", "Middleware защита", "Демо-аккаунты"],
    icon: Users,
  },
  {
    id: 2,
    name: "Организация и сотрудники",
    description: "Настройки, филиалы, кабинеты, сотрудники с CRUD",
    status: "done",
    version: "v0.3.0",
    date: "30.03.2026",
    features: ["Настройки организации", "Филиалы и кабинеты", "CRUD сотрудников", "Дата рождения", "Сайдбар из сессии"],
    icon: Users,
  },
  {
    id: 3,
    name: "Клиенты и подопечные",
    description: "Список клиентов, карточка, подопечные, воронка статусов",
    status: "done",
    version: "v0.4.0",
    date: "30.03.2026",
    features: ["Список с фильтрами", "Карточка клиента", "Подопечные", "Сегментация", "Лид→Клиент"],
    icon: Users,
  },
  {
    id: 4,
    name: "Группы и расписание",
    description: "Группы, шаблоны расписания, генерация занятий, зачисление",
    status: "done",
    version: "v0.5.0",
    date: "30.03.2026",
    features: ["Недельный вид", "Создание групп", "Шаблоны расписания", "Генерация на месяц", "Зачисление учеников"],
    icon: Calendar,
  },
  {
    id: 5,
    name: "Абонементы, оплаты, посещения",
    description: "Абонементы с автосчётом, оплаты, касса, отметка посещений",
    status: "done",
    version: "v0.6.0",
    date: "31.03.2026",
    features: ["Абонементы (создание, статусы)", "Оплаты с привязкой", "Касса и счета", "Lesson card", "Отметка посещений", "Автосписание с абонемента", "Расчёт ЗП инструктора"],
    icon: CreditCard,
  },
  {
    id: 6,
    name: "Финансы: ДДС, расходы, зарплаты",
    description: "Движение денежных средств, расходы, зарплатная ведомость, выплаты",
    status: "planned",
    version: "v0.7.0",
    features: ["ДДС (приход/расход)", "Статьи расходов", "Повторяющиеся расходы", "Зарплатная ведомость", "Аванс/зарплата", "Выемки и инкассации"],
    icon: CreditCard,
  },
  {
    id: 7,
    name: "Отчёты",
    description: "Воронка, отток, финрез, активные абонементы, должники, LTV",
    status: "planned",
    version: "v0.8.0",
    features: ["Воронка продаж", "Детализация оттока", "Финрез (P&L)", "Активные абонементы", "Должники", "LTV", "Свободные места", "Сверка актива"],
    icon: BarChart3,
  },
  {
    id: 8,
    name: "Задачи и обзвон",
    description: "Автозадачи, ручные задачи, модуль обзвона",
    status: "planned",
    version: "v0.9.0",
    features: ["Автозадачи (дни рождения, долги, пробники)", "Ручные задачи", "Обзвон: кампании", "Колокольчик уведомлений"],
    icon: Bell,
  },
  {
    id: 9,
    name: "Дашборд (реальные данные)",
    description: "Виджеты с реальной аналитикой, настраиваемый по ролям",
    status: "planned",
    version: "v0.10.0",
    features: ["Карточки статистики", "Задачи на сегодня", "Неотмеченные занятия", "Должники", "Воронка мини"],
    icon: Rocket,
  },
  {
    id: 10,
    name: "Биллинг и ЛК партнёра/клиента",
    description: "SaaS-слой: подписка, счета, автоблокировка, ЛК клиента",
    status: "future",
    version: "v1.0.0",
    features: ["Автовыставление счетов", "Грейс-период", "Автоблокировка", "ЛК партнёра", "ЛК клиента (расписание, баланс, оплата)"],
    icon: Globe,
  },
]

const statusConfig: Record<ModuleStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: typeof CheckCircle2; color: string }> = {
  done: { label: "Готово", variant: "default", icon: CheckCircle2, color: "text-green-600" },
  in_progress: { label: "В работе", variant: "secondary", icon: Clock, color: "text-blue-600" },
  planned: { label: "Планируется", variant: "outline", icon: Circle, color: "text-muted-foreground" },
  future: { label: "Будущее", variant: "outline", icon: Circle, color: "text-muted-foreground/50" },
}

export default function RoadmapPage() {
  const doneCount = modules.filter(m => m.status === "done").length
  const totalCount = modules.length
  const progress = Math.round((doneCount / totalCount) * 100)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Roadmap</h1>
        <p className="text-sm text-muted-foreground">
          План разработки Умной CRM — {doneCount} из {totalCount} модулей готово ({progress}%)
        </p>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Прогресс MVP</span>
          <span className="font-medium">{progress}%</span>
        </div>
        <div className="h-3 rounded-full bg-muted">
          <div className="h-3 rounded-full bg-green-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Старт: 25.03.2026</span>
          <span>Дедлайн MVP: 01.06.2026</span>
        </div>
      </div>

      {/* Modules */}
      <div className="space-y-4">
        {modules.map((mod) => {
          const config = statusConfig[mod.status]
          const StatusIcon = config.icon
          return (
            <Card key={mod.id} className={mod.status === "future" ? "opacity-60" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`flex size-10 items-center justify-center rounded-lg bg-muted ${config.color}`}>
                      <mod.icon className="size-5" />
                    </div>
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <span className="text-muted-foreground text-sm">#{mod.id}</span>
                        {mod.name}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">{mod.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {mod.date && <span className="text-xs text-muted-foreground">{mod.date}</span>}
                    <Badge variant={config.variant}>{mod.version}</Badge>
                    <div className="flex items-center gap-1">
                      <StatusIcon className={`size-4 ${config.color}`} />
                      <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {mod.features.map((f) => (
                    <span key={f} className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs">{f}</span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
