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
  status: "done" | "active" | "upcoming" | "future"
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
// МОДУЛИ — актуальный статус на 17.06.2026
// ═══════════════════════════════════════════
const modules: RoadmapModule[] = [
  {
    name: "CRM",
    icon: Users,
    done: 41,
    total: 41,
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
      { id: "CRM-18", text: "Автосортировка лидов", status: "done" },
      { id: "CRM-22", text: "Быстрое создание лида «+»", status: "done" },
      { id: "CRM-19", text: "Сегментация клиентов (пороги по сумме/времени)", status: "done" },
      { id: "CRM-20", text: "Модуль обзвона", status: "done" },
      { id: "CRM-23", text: "Контакты/Продажи: воронка по заявке (Application.stage)", status: "done" },
      { id: "CRM-24", text: "Реестр «Дети» + карточка ребёнка с историей", status: "done" },
      { id: "CRM-25", text: "Запрет дублей клиентов/заявок/абонементов", status: "done" },
      { id: "CRM-13…38", text: "Фронты всех отчётов (52 страницы) — API-only закрыты", status: "done" },
    ],
  },
  {
    name: "Расписание",
    icon: Calendar,
    done: 14,
    total: 14,
    items: [
      { id: "SCH-01", text: "Иерархия: филиал → кабинет → группа", status: "done" },
      { id: "SCH-02", text: "Группы с шаблонами", status: "done" },
      { id: "SCH-03", text: "Помесячная генерация", status: "done" },
      { id: "SCH-03a", text: "Закрытие/архив группы", status: "done" },
      { id: "SCH-04", text: "Фильтры по кабинетам/инструкторам/направлениям", status: "done" },
      { id: "SCH-05", text: "Цветовая индикация заполняемости", status: "done" },
      { id: "SCH-07", text: "Перевод между группами", status: "done" },
      { id: "SCH-08", text: "Замена инструктора + ЗП заменяющему", status: "done" },
      { id: "SCH-09", text: "Массовая отмена занятий (праздники)", status: "done" },
      { id: "SCH-11", text: "Разовые занятия / отработки", status: "done" },
      { id: "SCH-12", text: "Перегенерация расписания при смене дат группы", status: "done" },
      { id: "SCH-13", text: "Массовое копирование расписания (месяц)", status: "done" },
      { id: "SCH-14", text: "Индивидуальное расписание ученика", status: "done" },
      { id: "SCH-17", text: "Печать расписания", status: "done" },
    ],
  },
  {
    name: "Посещения и Занятия",
    icon: CheckCircle2,
    done: 18,
    total: 18,
    items: [
      { id: "ATT-01…08", text: "Отметка, автосписание, закрытие периода", status: "done" },
      { id: "ATT-09", text: "Отчёт «Неотмеченные дети»", status: "done" },
      { id: "ATT-10", text: "Отчёт «Потенциальный отток»", status: "done" },
      { id: "ATT-13…14", text: "Тема занятия, ДЗ, lesson card", status: "done" },
      { id: "ATT-15", text: "Настраиваемая матрица видов посещений (Ф1)", status: "done" },
      { id: "ATT-16", text: "chargePercent — частичное списание с возвратом (Ф2)", status: "done" },
      { id: "LSN-01", text: "Раздел «Занятия» + сетка посещений по группам и дням", status: "done" },
      { id: "LSN-02", text: "Отчёт «Пропуски» + добавление ученика на занятие", status: "done" },
    ],
  },
  {
    name: "Абонементы и Скидки",
    icon: CreditCard,
    done: 18,
    total: 19,
    items: [
      { id: "SUB-01…06", text: "Календарный тип, баланс, отчисление", status: "done" },
      { id: "SUB-11", text: "Закрытие абонемента (возврат на баланс клиента)", status: "done" },
      { id: "SUB-12", text: "Перенос баланса", status: "done" },
      { id: "SUB-14", text: "Тип «Пакетный» (UI + бизнес-логика + отчёты)", status: "done" },
      { id: "SUB-15", text: "Разовое посещение (single_visit_price)", status: "done" },
      { id: "SUB-16", text: "Плоский список /crm/subscriptions + массовая выписка", status: "done" },
      { id: "DISC-01", text: "Скидки v2: автоскидка за второй абонемент, скидка в цене занятия", status: "done" },
      { id: "DISC-02", text: "Шаблоны скидок с ручным включением + разовые маркетинговые бонусы", status: "done" },
      { id: "SUB-13", text: "Тип «Фиксированный» (enum есть, UI «в разработке»)", status: "partial" },
    ],
  },
  {
    name: "Финансы",
    icon: BarChart3,
    done: 37,
    total: 37,
    items: [
      { id: "FIN-01…14", text: "Расходы, ДДС, кассы, P&L, оплаты, СБП", status: "done" },
      { id: "FIN-15", text: "P&L по направлениям (формат B)", status: "done" },
      { id: "FIN-16", text: "Автораспределение расходов", status: "done" },
      { id: "FIN-18", text: "Возврат средств клиенту", status: "done" },
      { id: "FIN-21", text: "Онлайн-оплата: webhook (idempotency, IP whitelist)", status: "done" },
      { id: "FIN-26", text: "Drill-down в отчётах", status: "done" },
      { id: "FIN-27", text: "Экспорт Excel", status: "done" },
      { id: "FIN-28", text: "Фундамент ОПИУ/ДДС: режимы признания расхода, раскладка на N мес", status: "done" },
      { id: "FIN-29", text: "Единый ledger баланса клиента (ClientBalanceTransaction)", status: "done" },
      { id: "FIN-30", text: "Ручная оплата абонементов (отказ от автозачисления, распределение)", status: "done" },
      { id: "FIN-31", text: "Источник долга в «Должниках»; две вкладки (плановый/фактический)", status: "done" },
      { id: "FIN-32", text: "Расходы по направлению/каналу — прямое отнесение в P&L", status: "done" },
      { id: "FIN-33", text: "Документ выплаты ЗП с разбивкой по сотрудникам/направлениям/счетам", status: "done" },
    ],
  },
  {
    name: "Зарплата",
    icon: CreditCard,
    done: 18,
    total: 19,
    items: [
      { id: "SAL-01…09", text: "3 схемы ЗП, автоначисление, премии, бонус админа", status: "done" },
      { id: "SAL-10", text: "Оплата пробных (payForTrialLessons)", status: "done" },
      { id: "SAL-11", text: "ЗП при замене инструктора", status: "done" },
      { id: "SAL-11b", text: "Корректировки прошлых периодов", status: "done" },
      { id: "SAL-12", text: "Расширенные схемы ставок: процент, плавающая матрица, ставка на группу", status: "done" },
      { id: "SAL-13", text: "Авто-корректировка при откате выплаченных отметок (SalaryAdjustment)", status: "done" },
      { id: "SAL-11a", text: "Документы сотрудника (PDF, загрузка файлов)", status: "future" },
    ],
  },
  {
    name: "Дашборд + Задачи",
    icon: Rocket,
    done: 4,
    total: 5,
    items: [
      { id: "DSH", text: "Задачи (CRUD + 5 автотриггеров)", status: "done" },
      { id: "DSH-02", text: "15+ виджетов: прогноз прибыли, активные абонементы, остатки денег, дни рождения, не пришли на пробник…", status: "done" },
      { id: "DSH-03", text: "RBAC: инструктор — главная без виджетов, только свои занятия", status: "done" },
      { id: "DSH-01", text: "Видимость + ручной порядок виджетов (localStorage)", status: "done" },
      { id: "DSH-04", text: "Drag&drop виджетов мышью", status: "future" },
    ],
  },
  {
    name: "Обзвон",
    icon: Bell,
    done: 5,
    total: 5,
    items: [
      { id: "CALL-01…03", text: "Фильтр → список → обзвон → результаты", status: "done" },
      { id: "CALL-04", text: "Связь с историей коммуникации", status: "done" },
    ],
  },
  {
    name: "Склад",
    icon: Package,
    done: 5,
    total: 5,
    items: [
      { id: "INV-01", text: "Закупка товаров", status: "done" },
      { id: "INV-02", text: "Перемещение склад → кабинет", status: "done" },
      { id: "INV-03", text: "Баланс кабинета", status: "done" },
      { id: "INV-04", text: "Амортизация при закупке", status: "done" },
      { id: "INV-06", text: "Отчёт «Остатки»", status: "done" },
    ],
  },
  {
    name: "Администрирование",
    icon: Settings,
    done: 17,
    total: 17,
    items: [
      { id: "ADM-01…02", text: "Мультитенант, RLS, 5 ролей", status: "done" },
      { id: "ADM-03", text: "Настройка прав ролей (матрица)", status: "done" },
      { id: "ADM-04", text: "Разграничение доступа по филиалам (admin + instructor)", status: "done" },
      { id: "ADM-05", text: "Wizard онбординга (6 шагов)", status: "done" },
      { id: "ADM-08", text: "Справочник каналов", status: "done" },
      { id: "ADM-09", text: "Справочник причин отчисления", status: "done" },
      { id: "ADM-09a", text: "Справочник причин пропусков", status: "done" },
      { id: "ADM-11", text: "Импорт клиентов + синхронизация остатков (XLSX)", status: "done" },
      { id: "ADM-14", text: "Кастомные названия ролей (roleDisplayNames)", status: "done" },
      { id: "ADM-15", text: "Маскирование телефонов у инструктора (жёсткая политика, без настройки)", status: "done" },
    ],
  },
  {
    name: "Кандидаты (HR)",
    icon: Users,
    done: 4,
    total: 4,
    items: [
      { id: "CAND-01…04", text: "Список, карточка, статусы, встречи", status: "done" },
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
    name: "Фаза 1: Финализация",
    period: "Апрель 2026",
    status: "done",
    tasks: [
      { text: "Фильтры расписания по кабинетам/инструкторам", status: "done" },
      { text: "Цветовая индикация заполняемости групп", status: "done" },
      { text: "Замена инструктора + ЗП заменяющему", status: "done" },
      { text: "Массовая отмена занятий (праздники)", status: "done" },
      { text: "Возвраты — полный UI flow", status: "done" },
      { text: "Онлайн-оплата — webhook (idempotency, IP whitelist)", status: "done" },
      { text: "P&L по направлениям, автораспределение расходов", status: "done" },
      { text: "Автосортировка лидов, допродажи, объединение дубликатов", status: "done" },
      { text: "Оплата пробных, корректировки прошлых периодов", status: "done" },
      { text: "Автопредложение переноса баланса при новом абонементе", status: "done" },
      { text: "Связь обзвонов с историей коммуникации", status: "done" },
      { text: "Модуль «Склад» (INV-01…06)", status: "done" },
      { text: "Модуль «Кандидаты» (CAND-01…04)", status: "done" },
    ],
  },
  {
    name: "Фаза 2: Стабилизация и пилот",
    period: "Май 2026",
    status: "done",
    tasks: [
      { text: "Хлебные крошки, PWA (service worker + manifest)", status: "done" },
      { text: "Security hardening (rate-limit, JWT, helmet)", status: "done" },
      { text: "Бэкапы БД + Telegram-алерты health-check", status: "done" },
      { text: "AI-чат для партнёров", status: "done" },
      { text: "/testing (220+ кейсов), /bugs, /dev", status: "done" },
      { text: "Почтовый сервер + восстановление пароля по email", status: "done" },
      { text: "Лендинг /lp (готов)", status: "done" },
      { text: "Матрица видов посещений + расширенные ставки ЗП (Ф1–Ф3)", status: "done" },
      { text: "Реестр «Дети», история ребёнка, безопасность телефонов (Ф5–Ф6)", status: "done" },
    ],
  },
  {
    name: "Фаза 3: Финансы, отчёты, прод-кандидат",
    period: "Июнь 2026",
    status: "active",
    tasks: [
      { text: "Фундамент ОПИУ/ДДС + режимы признания расхода", status: "done" },
      { text: "Пакетные абонементы (SUB-14) + плоский список /crm/subscriptions", status: "done" },
      { text: "Скидки v2 + ручная оплата абонементов (отказ от автозачисления)", status: "done" },
      { text: "Откат модели «баланс-долг»: clientBalance = деньги + единый ledger", status: "done" },
      { text: "Дашборд: 15+ виджетов, ручной порядок", status: "done" },
      { text: "Фронты всех отчётов (52) — API-only закрыты", status: "done" },
      { text: "Раздел «Занятия» + отчёт «Пропуски»", status: "done" },
      { text: "Прод-кандидат msk1.umnayacrm.ru (Timeweb) + CI/Telegram", status: "done" },
      { text: "Глобальный переключатель филиала в шапке", status: "not_done" },
      { text: "Оптимизация производительности при 500 клиентах", status: "not_done" },
    ],
  },
  {
    name: "Фаза 4: Запуск MVP",
    period: "Июнь–Июль 2026",
    status: "upcoming",
    tasks: [
      { text: "Миграция 20 текущих клиентов из 1С", status: "not_done" },
      { text: "Боевая настройка почтового сервера (DNS, порт 25, DKIM)", status: "not_done" },
      { text: "Перенос домена app.umnayacrm.ru на прод + вывод Hetzner", status: "not_done" },
      { text: "Документация для партнёров, мониторинг и алерты (prod)", status: "not_done" },
    ],
  },
]

const postMvp = [
  { version: "Ближайшее", items: ["Абонемент тип «Фикс» (включить выключенный UI)", "Документы сотрудника (PDF, загрузка файлов)", "Cron автоматической массовой выписки 1-го числа", "Глобальный переключатель филиала в шапке", "Настоящая пагинация /crm/subscriptions"] },
  { version: "После MVP", items: ["Drag&drop виджетов дашборда", "Телеграм-бот уведомлений", "Интеграция с Мой Класс / AmoCRM", "Печать расписания — расширенные форматы"] },
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
          Умная CRM v1.6.0-alpha — статус на 17 июня 2026, подготовка к пилоту
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
                <p className="font-medium text-foreground">Жёсткий дедлайн: 1 августа 2026</p>
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
          { label: "Страниц", value: "132" },
          { label: "API endpoints", value: "222" },
          { label: "Моделей БД", value: "65" },
          { label: "Отчётов", value: "52" },
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
            <Card key={phase.name} className={phase.status === "active" ? "border-blue-200 dark:border-blue-800" : phase.status === "done" ? "opacity-75" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{phase.name}</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{phase.period}</span>
                    {phase.status === "done" && <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Завершена</Badge>}
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
      <CollapsibleSection title="Тесты" icon={FileText} badge="28 файлов / 9 500+ строк" defaultOpen={false}>
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
