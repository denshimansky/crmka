"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle2, Circle, Clock, Calendar, CreditCard, BarChart3, Bell, Users, Globe, Rocket, Shield, Package, Settings, FileText, ArrowRight, ChevronDown, ChevronRight, ListTodo } from "lucide-react"

type ItemStatus = "done" | "partial" | "not_done" | "future"

interface RoadmapModule {
  name: string
  icon: typeof Rocket
  done: number
  total: number
  items: { id: string; text: string; status: ItemStatus }[]
}

interface Phase {
  name: string
  period: string
  status: "active" | "upcoming" | "future"
  tasks: { text: string; status: ItemStatus }[]
}

interface NextTask {
  text: string
  status: "done" | "in_progress" | "todo"
  priority?: "high" | "medium" | "low"
}

// ═══════════════════════════════════════════
// БЛИЖАЙШИЕ ЗАДАЧИ — обновляется по ходу работы
// ═══════════════════════════════════════════
const nextTasks: NextTask[] = [
  // Сюда добавляем задачи по мере работы
  // { text: "Пример задачи", status: "todo", priority: "high" },
]

// ═══════════════════════════════════════════
// МОДУЛИ — актуальный статус на 10.04.2026
// ═══════════════════════════════════════════
const modules: RoadmapModule[] = [
  {
    name: "CRM",
    icon: Users,
    done: 36,
    total: 38,
    items: [
      { id: "CRM-01", text: "Карточка лида/клиента", status: "done" },
      { id: "CRM-02", text: "История коммуникации (лента)", status: "done" },
      { id: "CRM-03", text: "Подопечные", status: "done" },
      { id: "CRM-04", text: "Воронка лидов", status: "done" },
      { id: "CRM-05", text: "Допродажи и возвраты", status: "done" },
      { id: "CRM-07", text: "Справочник каналов привлечения", status: "done" },
      { id: "CRM-08", text: "Автозадачи (5 триггеров)", status: "done" },
      { id: "CRM-10", text: "Защита от дублей + предупреждение", status: "done" },
      { id: "CRM-12", text: "Объединение дубликатов (merge)", status: "done" },
      { id: "CRM-17", text: "Отчёт «Допродажи и возвраты»", status: "done" },
      { id: "CRM-18", text: "Автосортировка лидов", status: "partial" },
      { id: "CRM-22", text: "Быстрое создание лида «+»", status: "done" },
      { id: "CRM-19", text: "Сегментация клиентов", status: "done" },
      { id: "CRM-20", text: "Модуль обзвона", status: "done" },
      { id: "CRM-13…38", text: "23 отчёта CRM", status: "done" },
    ],
  },
  {
    name: "Расписание",
    icon: Calendar,
    done: 10,
    total: 16,
    items: [
      { id: "SCH-01", text: "Иерархия: филиал → кабинет → группа", status: "done" },
      { id: "SCH-02", text: "Группы с шаблонами", status: "done" },
      { id: "SCH-03", text: "Помесячная генерация", status: "done" },
      { id: "SCH-03a", text: "Закрытие/архив группы", status: "done" },
      { id: "SCH-04", text: "Просмотр по кабинетам/инструкторам", status: "partial" },
      { id: "SCH-05", text: "Цветовая индикация заполняемости", status: "partial" },
      { id: "SCH-07", text: "Перевод между группами", status: "done" },
      { id: "SCH-08", text: "Замена инструктора", status: "partial" },
      { id: "SCH-09", text: "Массовая отмена занятий (праздники)", status: "partial" },
      { id: "SCH-13", text: "Массовое копирование расписания", status: "future" },
      { id: "SCH-14", text: "Индивидуальное расписание", status: "future" },
      { id: "SCH-17", text: "Печать расписания", status: "future" },
    ],
  },
  {
    name: "Посещения",
    icon: CheckCircle2,
    done: 13,
    total: 13,
    items: [
      { id: "ATT-01…08", text: "Отметка, автосписание, закрытие периода", status: "done" },
      { id: "ATT-09", text: "Отчёт «Неотмеченные дети»", status: "done" },
      { id: "ATT-10", text: "Отчёт «Потенциальный отток»", status: "done" },
    ],
  },
  {
    name: "Абонементы",
    icon: CreditCard,
    done: 11,
    total: 14,
    items: [
      { id: "SUB-01…06", text: "Календарный тип, баланс, скидки, отчисление", status: "done" },
      { id: "SUB-07", text: "Связанная скидка: пересчёт", status: "done" },
      { id: "SUB-11", text: "Возврат средств", status: "partial" },
      { id: "SUB-12", text: "Перенос баланса", status: "done" },
      { id: "SUB-13", text: "Тип «Фиксированный»", status: "future" },
      { id: "SUB-14", text: "Тип «Пакетный»", status: "future" },
      { id: "SUB-15", text: "Разовая услуга", status: "future" },
    ],
  },
  {
    name: "Финансы",
    icon: BarChart3,
    done: 29,
    total: 31,
    items: [
      { id: "FIN-01…14", text: "Расходы, ДДС, кассы, P&L, оплаты, СБП", status: "done" },
      { id: "FIN-15", text: "P&L по направлениям", status: "done" },
      { id: "FIN-16", text: "Автораспределение расходов", status: "partial" },
      { id: "FIN-18", text: "Возврат средств клиенту", status: "done" },
      { id: "FIN-21", text: "Онлайн-оплата: webhook", status: "partial" },
      { id: "FIN-26", text: "Drill-down в отчётах", status: "done" },
      { id: "FIN-27", text: "Экспорт Excel", status: "done" },
    ],
  },
  {
    name: "Зарплата",
    icon: CreditCard,
    done: 14,
    total: 17,
    items: [
      { id: "SAL-01…09", text: "3 схемы ЗП, автоначисление, премии, бонус админа", status: "done" },
      { id: "SAL-10", text: "Оплата пробных", status: "partial" },
      { id: "SAL-11", text: "ЗП при замене инструктора", status: "partial" },
      { id: "SAL-11a", text: "Документы сотрудника (PDF)", status: "future" },
      { id: "SAL-11b", text: "Корректировки прошлых периодов", status: "partial" },
    ],
  },
  {
    name: "Дашборд + Задачи",
    icon: Rocket,
    done: 7,
    total: 7,
    items: [
      { id: "DSH", text: "8 виджетов, задачи (CRUD + автотриггеры)", status: "done" },
      { id: "DSH-01", text: "Настраиваемый дашборд (drag/toggle)", status: "future" },
    ],
  },
  {
    name: "Обзвон",
    icon: Bell,
    done: 4,
    total: 5,
    items: [
      { id: "CALL-01…03", text: "Фильтр → список → обзвон → результаты", status: "done" },
      { id: "CALL-04", text: "Связь с историей коммуникации", status: "partial" },
    ],
  },
  {
    name: "Склад",
    icon: Package,
    done: 0,
    total: 5,
    items: [
      { id: "INV-01", text: "Закупка товаров", status: "future" },
      { id: "INV-02", text: "Перемещение склад → кабинет", status: "future" },
      { id: "INV-03", text: "Баланс кабинета", status: "future" },
      { id: "INV-04", text: "Амортизация при закупке", status: "future" },
      { id: "INV-06", text: "Отчёт «Остатки»", status: "future" },
    ],
  },
  {
    name: "Администрирование",
    icon: Settings,
    done: 13,
    total: 15,
    items: [
      { id: "ADM-01…02", text: "Мультитенант, RLS, 5 ролей", status: "done" },
      { id: "ADM-03", text: "Настройка прав ролей (матрица)", status: "done" },
      { id: "ADM-05", text: "Wizard онбординга (6 шагов)", status: "done" },
      { id: "ADM-08", text: "Справочник каналов", status: "done" },
      { id: "ADM-09", text: "Справочник причин отчисления", status: "partial" },
      { id: "ADM-09a", text: "Справочник причин пропусков", status: "done" },
      { id: "ADM-11", text: "Импорт клиентов (CSV/XLSX)", status: "done" },
      { id: "ADM-14", text: "Кастомные названия ролей", status: "future" },
    ],
  },
  {
    name: "Кандидаты (HR)",
    icon: Users,
    done: 0,
    total: 4,
    items: [
      { id: "CAND-01…04", text: "Список, карточка, статусы, встречи", status: "future" },
    ],
  },
  {
    name: "Бэк-офис SaaS",
    icon: Shield,
    done: 7,
    total: 7,
    items: [
      { id: "BO", text: "Партнёры, тарифы, подписки, счета, блокировка", status: "done" },
      { id: "BO-IMP", text: "Impersonation «Войти как партнёр»", status: "done" },
      { id: "BO-DASH", text: "Управленческий дашборд", status: "done" },
    ],
  },
  {
    name: "Личные кабинеты",
    icon: Globe,
    done: 2,
    total: 2,
    items: [
      { id: "LK-P", text: "ЛК партнёра: подписка, счета", status: "done" },
      { id: "LK-C", text: "ЛК клиента: расписание, баланс, оплаты", status: "done" },
    ],
  },
]

const phases: Phase[] = [
  {
    name: "Фаза 1: Финализация PARTIAL",
    period: "Апрель 2026",
    status: "active",
    tasks: [
      { text: "Фильтры расписания по кабинетам/инструкторам", status: "not_done" },
      { text: "Цветовая индикация заполняемости групп", status: "not_done" },
      { text: "Логика ЗП при замене инструктора", status: "not_done" },
      { text: "Массовая отмена занятий (праздники)", status: "not_done" },
      { text: "Возвраты — полный UI flow", status: "not_done" },
      { text: "Онлайн-оплата — webhook, idempotency", status: "not_done" },
      { text: "Справочник причин отчисления (модель)", status: "not_done" },
      { text: "Связь обзвонов с историей коммуникации", status: "not_done" },
    ],
  },
  {
    name: "Фаза 2: Стабилизация и пилот",
    period: "Май 2026",
    status: "upcoming",
    tasks: [
      { text: "Глобальный переключатель филиала", status: "not_done" },
      { text: "Хлебные крошки", status: "done" },
      { text: "PWA (service worker + manifest)", status: "done" },
      { text: "Баги от пилотных партнёров", status: "not_done" },
      { text: "Оптимизация производительности", status: "not_done" },
      { text: "Обновление тестов под новые фичи", status: "not_done" },
    ],
  },
  {
    name: "Фаза 3: Запуск MVP",
    period: "Июнь 2026",
    status: "future",
    tasks: [
      { text: "Миграция 20 текущих клиентов из 1С", status: "not_done" },
      { text: "Домен app.umnayacrm.ru → prod", status: "not_done" },
      { text: "Документация для партнёров", status: "not_done" },
      { text: "Мониторинг и алерты (prod)", status: "not_done" },
    ],
  },
]

const postMvp = [
  { version: "v1.1", items: ["Модуль «Склад» (5 задач)", "Модуль «Кандидаты» (4 задачи)", "Массовое копирование расписания", "Абонемент тип «Фикс»", "Печать расписания", "Документы сотрудника (PDF)", "Кастомные названия ролей"] },
  { version: "v2.0", items: ["Абонемент тип «Пакетный»", "Разовая услуга", "Настраиваемый дашборд (drag & drop)", "Телеграм-бот уведомлений", "Интеграция с Мой Класс / AmoCRM"] },
]

const statusConfig: Record<ItemStatus, { label: string; color: string; bg: string }> = {
  done: { label: "Готово", color: "text-green-600", bg: "bg-green-100 dark:bg-green-900/30" },
  partial: { label: "Частично", color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900/30" },
  not_done: { label: "В работе", color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900/30" },
  future: { label: "Планы", color: "text-muted-foreground", bg: "bg-muted" },
}

const taskStatusConfig = {
  done: { icon: CheckCircle2, color: "text-green-600" },
  in_progress: { icon: Clock, color: "text-blue-600" },
  todo: { icon: Circle, color: "text-muted-foreground" },
}

const priorityConfig = {
  high: { label: "Высокий", variant: "destructive" as const },
  medium: { label: "Средний", variant: "secondary" as const },
  low: { label: "Низкий", variant: "outline" as const },
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = Math.round((done / total) * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-muted">
        <div
          className={`h-2 rounded-full transition-all ${pct === 100 ? "bg-green-500" : pct >= 70 ? "bg-blue-500" : pct >= 40 ? "bg-amber-500" : "bg-red-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium tabular-nums">{done}/{total}</span>
    </div>
  )
}

function CollapsibleSection({ title, icon: Icon, badge, defaultOpen = false, children }: {
  title: string
  icon: typeof Rocket
  badge?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 py-2 text-left"
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold">{title}</h2>
        {badge && <Badge variant="secondary" className="ml-1">{badge}</Badge>}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

export default function RoadmapPage() {
  const totalDone = modules.reduce((s, m) => s + m.done, 0)
  const totalAll = modules.reduce((s, m) => s + m.total, 0)
  const pct = Math.round((totalDone / totalAll) * 100)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Roadmap</h1>
        <p className="text-sm text-muted-foreground">
          Умная CRM v1.5.2-alpha — план разработки до MVP (1 июня 2026)
        </p>
      </div>

      {/* Global progress */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{pct}%</p>
                <p className="text-sm text-muted-foreground">{totalDone} из {totalAll} требований PRD</p>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                <p>Старт: 25 марта 2026</p>
                <p className="font-medium text-foreground">Дедлайн: 1 июня 2026</p>
              </div>
            </div>
            <div className="h-4 rounded-full bg-muted">
              <div className="h-4 rounded-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex gap-4 text-xs">
              <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-green-500" /> Готово ({totalDone})</span>
              <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-amber-500" /> Частично ({modules.reduce((s, m) => s + m.items.filter(i => i.status === "partial").length, 0)})</span>
              <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-blue-500" /> В работе ({modules.reduce((s, m) => s + m.items.filter(i => i.status === "not_done").length, 0)})</span>
              <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-gray-300 dark:bg-gray-600" /> Планы ({modules.reduce((s, m) => s + m.items.filter(i => i.status === "future").length, 0)})</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Страниц", value: "60" },
          { label: "API endpoints", value: "159" },
          { label: "Моделей БД", value: "51" },
          { label: "Тестовых файлов", value: "26" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Ближайшие задачи */}
      {nextTasks.length > 0 && (
        <CollapsibleSection title="Ближайшие задачи" icon={ListTodo} badge={`${nextTasks.filter(t => t.status === "done").length}/${nextTasks.length}`} defaultOpen={true}>
          <Card className="border-blue-200 dark:border-blue-800">
            <CardContent className="pt-4">
              <div className="space-y-2">
                {nextTasks.map((task) => {
                  const cfg = taskStatusConfig[task.status]
                  const TaskIcon = cfg.icon
                  return (
                    <div key={task.text} className="flex items-center gap-2 text-sm">
                      <TaskIcon className={`size-4 shrink-0 ${cfg.color}`} />
                      <span className={task.status === "done" ? "line-through text-muted-foreground" : ""}>{task.text}</span>
                      {task.priority && (
                        <Badge variant={priorityConfig[task.priority].variant} className="ml-auto text-xs">
                          {priorityConfig[task.priority].label}
                        </Badge>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </CollapsibleSection>
      )}

      {/* Phases */}
      <CollapsibleSection title="Фазы до MVP" icon={Rocket} defaultOpen={true}>
        <div className="space-y-4">
          {phases.map((phase) => (
            <Card key={phase.name} className={phase.status === "active" ? "border-blue-200 dark:border-blue-800" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{phase.name}</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{phase.period}</span>
                    {phase.status === "active" && <Badge variant="default">Текущая</Badge>}
                    {phase.status === "upcoming" && <Badge variant="secondary">Скоро</Badge>}
                    {phase.status === "future" && <Badge variant="outline">Впереди</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {phase.tasks.map((task) => (
                    <div key={task.text} className="flex items-center gap-2 text-sm">
                      {task.status === "done" ? (
                        <CheckCircle2 className="size-4 shrink-0 text-green-600" />
                      ) : task.status === "partial" ? (
                        <Clock className="size-4 shrink-0 text-amber-600" />
                      ) : (
                        <Circle className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span>{task.text}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CollapsibleSection>

      {/* Modules */}
      <CollapsibleSection title="Модули" icon={BarChart3} badge={`${pct}%`} defaultOpen={false}>
        <div className="space-y-3">
          {modules.map((mod) => {
            const modPct = Math.round((mod.done / mod.total) * 100)
            const ModIcon = mod.icon
            return (
              <Card key={mod.name}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className={`flex size-8 items-center justify-center rounded-lg ${modPct === 100 ? "bg-green-100 text-green-600 dark:bg-green-900/30" : "bg-muted text-muted-foreground"}`}>
                      <ModIcon className="size-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{mod.name}</CardTitle>
                        <Badge variant={modPct === 100 ? "default" : modPct >= 70 ? "secondary" : "outline"}>
                          {modPct}%
                        </Badge>
                      </div>
                      <ProgressBar done={mod.done} total={mod.total} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-1.5">
                    {mod.items.map((item) => {
                      const cfg = statusConfig[item.status]
                      return (
                        <span
                          key={item.id}
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${cfg.bg}`}
                          title={`${item.id}: ${cfg.label}`}
                        >
                          <span className={`inline-block size-1.5 rounded-full ${item.status === "done" ? "bg-green-500" : item.status === "partial" ? "bg-amber-500" : item.status === "not_done" ? "bg-blue-500" : "bg-gray-400"}`} />
                          {item.text}
                        </span>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </CollapsibleSection>

      {/* Post-MVP */}
      <CollapsibleSection title="После MVP" icon={ArrowRight} defaultOpen={false}>
        <div className="grid gap-4 sm:grid-cols-2">
          {postMvp.map((release) => (
            <Card key={release.version} className="opacity-75">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{release.version}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {release.items.map((item) => (
                    <div key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <ArrowRight className="size-3 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CollapsibleSection>

      {/* Tests */}
      <CollapsibleSection title="Тесты" icon={FileText} badge="26 файлов / 9 500 строк" defaultOpen={false}>
        <Card>
          <CardContent className="pt-4">
            <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {[
                ["auth", "Авторизация"],
                ["navigation", "Навигация"],
                ["dashboard", "Дашборд"],
                ["staff", "Сотрудники"],
                ["expenses", "Расходы"],
                ["finance / finance-module6", "Финансы + ДДС"],
                ["reports", "Отчёты"],
                ["tasks-calls", "Задачи и обзвон"],
                ["admin-billing", "Бэк-офис"],
                ["partner-billing", "ЛК партнёра"],
                ["client-portal", "ЛК клиента"],
                ["mega-full-business", "Супертест (50 клиентов, 3.5 мес)"],
                ["mega-full-business-verify", "Верификация UI (46 проверок)"],
                ["e2e-complete-business", "E2E полный цикл"],
              ].map(([file, desc]) => (
                <div key={file} className="flex items-center gap-2 py-0.5">
                  <FileText className="size-3 shrink-0 text-muted-foreground" />
                  <span className="font-mono text-xs text-muted-foreground">{file}</span>
                  <span className="text-muted-foreground">—</span>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </CollapsibleSection>
    </div>
  )
}
