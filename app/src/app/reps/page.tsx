"use client"

import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Filter,
  Calendar,
  CreditCard,
  Wallet,
  Package,
  GraduationCap,
} from "lucide-react"

// ───────────────────────────────────────────────────────────────────────────
// ДАННЫЕ
// ───────────────────────────────────────────────────────────────────────────

type Status = "ok" | "partial" | "missing"

interface Report {
  id: string
  name: string
  /** Сущности и поля из БД, переведённые в понятный человеческий язык */
  data: string[]
  status: Status
  gap?: string
}

interface Module {
  key: string
  title: string
  icon: typeof Filter
  color: string
  reports: Report[]
}

const modules: Module[] = [
  {
    key: "crm",
    title: "CRM и маркетинг",
    icon: Filter,
    color: "text-blue-600",
    reports: [
      {
        id: "CRM-13",
        name: "Воронка продаж",
        data: [
          "Клиент: статус в воронке, дата создания",
          "Пробное занятие: дата, статус (назначен / посетил)",
          "Абонемент: дата создания, дата активации",
          "Оплата: дата, флаг первой оплаты",
        ],
        status: "ok",
      },
      {
        id: "CRM-14",
        name: "Конверсия пробных по инструкторам",
        data: [
          "Пробное занятие: педагог, статус, дата посещения",
          "Клиент: дата первого платного занятия",
          "Оплата: флаг первой оплаты",
        ],
        status: "ok",
      },
      {
        id: "CRM-15",
        name: "Лиды по каналам и менеджерам",
        data: [
          "Клиент: канал привлечения, ответственный менеджер, дата создания",
          "Справочник каналов привлечения",
          "Абонемент: дата создания",
          "Пробное занятие: даты назначения / посещения",
        ],
        status: "ok",
      },
      {
        id: "CRM-16",
        name: "Доходимость (по каналам)",
        data: [
          "Абонемент: дата создания",
          "Пробное занятие: дата назначения / посещения",
          "Оплата: дата",
          "Клиент: канал, дата первого платного занятия",
        ],
        status: "ok",
      },
      {
        id: "CRM-17",
        name: "Допродажи и возвраты",
        data: [
          "Клиент: статус (допродажа / возврат / активный)",
          "Абонемент: ссылка на предыдущий абонемент клиента",
          "Оплата: тип «возврат»",
        ],
        status: "ok",
      },
      {
        id: "CRM-19",
        name: "Сегментация клиентов",
        data: [
          "Клиент: сегмент (Новый / Стандарт / Постоянный / VIP)",
          "Клиент: общее количество абонементов",
        ],
        status: "ok",
      },
      {
        id: "CRM-23",
        name: "Детализация оттока",
        data: [
          "Абонемент: дата отчисления, причина отчисления",
          "Дата последнего платного занятия (вычисляется из посещений со списанием)",
          "Связи: педагог, направление, кабинет, филиал",
        ],
        status: "partial",
        gap: "Нет справочника «Причины отчисления» — поле есть, но таблицы и страницы настроек нет. Нет флагов «исключить из оттока по направлению / по педагогу» при отчислении",
      },
      {
        id: "CRM-24",
        name: "Непродлённые абонементы",
        data: [
          "Посещения со списанием за прошлый и текущий месяц",
          "Абонементы прошлого месяца без продолжения",
          "Комментарии администратора по непродлённым",
        ],
        status: "ok",
      },
      {
        id: "CRM-25",
        name: "Средний чек",
        data: [
          "Оплата: сумма, дата",
          "Количество платежей в периоде",
        ],
        status: "ok",
      },
      {
        id: "CRM-26",
        name: "Средняя стоимость абонемента",
        data: [
          "Абонемент: отработанная сумма",
          "Активные абонементы за месяц (со списаниями)",
        ],
        status: "ok",
      },
      {
        id: "CRM-27",
        name: "Конверсия оттока по педагогам",
        data: [
          "Абонемент: группа → педагог",
          "Активные и выбывшие абонементы у педагога",
        ],
        status: "partial",
        gap: "Нет флага «исключить из оттока по педагогу» при отчислении абонемента",
      },
      {
        id: "CRM-28",
        name: "Отток по месяцам",
        data: [
          "Клиент: дата продажи, дата первого платного занятия",
          "Дата последнего платного занятия",
        ],
        status: "ok",
      },
      {
        id: "CRM-29",
        name: "Отток по направлениям и филиалам",
        data: [
          "Активные и выбывшие абонементы",
          "Признак «закончил курс обучения» vs «ушёл с направления»",
        ],
        status: "missing",
        gap: "Нет поля «закончил курс» в абонементе и нет типизации причин отчисления. В отчёте /reports/churn-by-directions колонка completedCourse сейчас всегда возвращает 0",
      },
      {
        id: "CRM-30",
        name: "Лиды по дням",
        data: [
          "Клиент: дата создания, канал привлечения",
          "Абонемент: дата создания",
        ],
        status: "ok",
      },
      {
        id: "CRM-31",
        name: "Пробники по дням",
        data: [
          "Пробное занятие: дата назначения, дата фактического посещения",
          "Клиент: дата продажи",
        ],
        status: "ok",
      },
      {
        id: "CRM-32",
        name: "Не пришли на пробники",
        data: [
          "Пробное занятие: статус «не пришёл» / «отменено»",
        ],
        status: "ok",
      },
      {
        id: "CRM-33 / CALL-05",
        name: "Эффективность обзвонов",
        data: [
          "Кампания обзвона: название, период, ответственный",
          "Звонок в кампании: статус, результат (пробное / продажа / отказ / не дозвонились)",
        ],
        status: "partial",
        gap: "Поле «результат звонка» — свободная строка (нет enum), значения произвольные. Нет поля «дата закрытия кампании» — есть только updatedAt",
      },
      {
        id: "CRM-34",
        name: "Загруженность центра",
        data: [
          "Филиал: часы работы, рабочие дни недели",
          "Кабинет: вместимость",
          "Занятие: длительность, посещения",
        ],
        status: "ok",
      },
      {
        id: "CRM-35",
        name: "Продажи менеджеров по каналам",
        data: [
          "Клиент: ответственный менеджер, канал привлечения",
          "Пробное занятие: даты",
          "Клиент: дата продажи, дата первого платного занятия",
        ],
        status: "ok",
      },
      {
        id: "CRM-36",
        name: "Сводный по абонементам в разрезе педагогов",
        data: [
          "Абонемент: группа → педагог",
          "Посещения со списаниями",
        ],
        status: "ok",
      },
      {
        id: "CRM-37",
        name: "Сколько денег приносит педагог",
        data: [
          "Посещение: сумма списания (выручка), ЗП инструктора",
          "Расход: переменные (со склада, по кабинету)",
          "Расход: постоянные (распределяются пропорционально)",
        ],
        status: "ok",
      },
      {
        id: "CRM-38",
        name: "Детализация пробников",
        data: ["Пробные занятия: все записи с полным составом полей"],
        status: "ok",
      },
    ],
  },
  {
    key: "sch",
    title: "Расписание",
    icon: Calendar,
    color: "text-green-600",
    reports: [
      {
        id: "SCH-15",
        name: "Свободные места",
        data: [
          "Группа: лимит мест",
          "Зачисление в группу: активный, статус оплаты (активен / ждём оплату / пробный)",
          "Пробное занятие: записан на пробное",
        ],
        status: "ok",
      },
    ],
  },
  {
    key: "att",
    title: "Посещения",
    icon: GraduationCap,
    color: "text-emerald-600",
    reports: [
      {
        id: "ATT-09",
        name: "Неотмеченные дети",
        data: [
          "Занятие: дата прошла",
          "Посещение: отсутствует запись по ученику",
        ],
        status: "ok",
      },
      {
        id: "ATT-10",
        name: "Потенциальный отток (3+ прогула подряд)",
        data: [
          "Посещение: тип = прогул, дата отметки",
          "Последовательность прогулов по клиенту",
        ],
        status: "ok",
      },
      {
        id: "ATT-11",
        name: "По посещениям",
        data: [
          "Посещение: тип (явка / прогул / перерасчёт / отработка), дата",
          "Справочник видов дня",
        ],
        status: "ok",
      },
      {
        id: "ATT-12",
        name: "Отсутствие учеников / потери выручки",
        data: [
          "Посещение: сумма списания",
          "Вид дня: признак «списывает с абонемента» / «считается в выручку»",
          "Подсчёт перерасчётов vs прогулов",
        ],
        status: "ok",
      },
      {
        id: "ATT-14",
        name: "Сверка актива",
        data: [
          "Клиент: статус «в активе»",
          "Оплата за текущий месяц",
          "Посещения со списанием (абонемент активирован)",
          "Дата последнего посещения, дней без посещений",
        ],
        status: "ok",
      },
    ],
  },
  {
    key: "fin",
    title: "Финансы",
    icon: CreditCard,
    color: "text-purple-600",
    reports: [
      {
        id: "FIN-06",
        name: "Должники",
        data: [
          "Абонемент: полная сумма, отработанная сумма, баланс",
          "Клиент: баланс, обещанная дата оплаты",
        ],
        status: "ok",
      },
      {
        id: "FIN-07",
        name: "Оплаты",
        data: [
          "Оплата: способ, дата, сумма, привязка к абонементу",
          "Абонемент, скидка, группа, педагог",
        ],
        status: "ok",
      },
      {
        id: "FIN-08",
        name: "ДДС (движение денежных средств)",
        data: [
          "Оплаты (приход)",
          "Расходы (списания)",
          "Внутренние операции: выемки, инкассации, переводы между счетами",
        ],
        status: "ok",
      },
      {
        id: "FIN-09",
        name: "Остаток денег",
        data: ["Счёт/Касса: баланс на дату"],
        status: "ok",
      },
      {
        id: "FIN-10",
        name: "Ожидаемые поступления",
        data: [
          "Абонемент: полная сумма, отработанная сумма",
          "Оплата: дата, сумма",
          "Неоплаченные абонементы за период",
        ],
        status: "ok",
      },
      {
        id: "FIN-11",
        name: "Выручка (отработанные абонементы)",
        data: ["Посещение: сумма списания (= выручка)"],
        status: "ok",
      },
      {
        id: "FIN-12",
        name: "Прогноз прибыли",
        data: [
          "Активные абонементы (планируемая сумма)",
          "Ставки ЗП + будущие занятия из расписания",
          "Среднее по складу (переменные расходы)",
          "Плановые расходы по статьям",
        ],
        status: "ok",
      },
      {
        id: "FIN-14",
        name: "Финрез формат A (общий P&L)",
        data: [
          "Посещения: суммы списаний (выручка)",
          "Расходы с амортизацией",
        ],
        status: "ok",
      },
      {
        id: "FIN-15",
        name: "Финрез формат B (направления / филиалы)",
        data: [
          "Абонемент: направление",
          "Группа: филиал",
          "Привязка расхода к филиалу / направлению",
        ],
        status: "ok",
      },
      {
        id: "FIN-15a",
        name: "Финрез формат C (группа)",
        data: [
          "Выручка группы (посещения по группе)",
          "ЗП инструктора за группу",
          "Доля переменных расходов (по кол-ву занятий)",
          "Доля постоянных расходов (по выручке)",
        ],
        status: "ok",
      },
      {
        id: "FIN-20",
        name: "Поступления по дням",
        data: [
          "Оплата: дата, способ оплаты",
          "Счёт/Касса",
        ],
        status: "ok",
      },
      {
        id: "FIN-23",
        name: "Расчёты с учениками",
        data: [
          "Абонемент: полная сумма, отработанная сумма, баланс",
          "Оплата по клиенту в периоде",
        ],
        status: "ok",
      },
      {
        id: "FIN-24",
        name: "Календарь постоянных платежей",
        data: [
          "Плановый расход: статья, плановая и фактическая сумма",
          "Расход: флаг «повторяющийся»",
          "Ставки ЗП (для авто-подтягивания зарплат)",
        ],
        status: "ok",
      },
      {
        id: "FIN-25",
        name: "Связанные скидки",
        data: [
          "Скидка: тип «связанная», клиент-основание",
          "Клиент: статус в воронке, дата отчисления",
        ],
        status: "ok",
      },
      {
        id: "FIN-28",
        name: "Остатки оплаченных занятий",
        data: [
          "Абонемент: количество занятий, дата окончания",
          "Количество отмеченных посещений",
        ],
        status: "ok",
      },
      {
        id: "FIN-29",
        name: "Доход от новых / упущенный по выбывшим",
        data: [
          "Клиент: дата первого платного занятия (новые)",
          "Клиент: дата отчисления",
          "Посещение: сумма списания",
        ],
        status: "ok",
      },
      {
        id: "FIN-30",
        name: "% распределения финреза",
        data: [
          "Расход: сумма по статьям",
          "Выручка как база для %",
        ],
        status: "ok",
      },
      {
        id: "FIN-31",
        name: "Контроль корректировок занятий (аудит)",
        data: [
          "Аудит-лог: изменения суммы списания в посещениях",
          "Кто изменил, когда, было / стало",
        ],
        status: "partial",
        gap: "Поля для лога есть, но нужно проверить, что бэкенд действительно пишет в AuditLog при ручной правке суммы списания на занятии",
      },
      {
        id: "FIN-32",
        name: "Контроль скидок (аудит)",
        data: [
          "Аудит-лог: создание разовых скидок",
          "Скидка: создатель, дата, сумма",
        ],
        status: "partial",
        gap: "Зависит от того, что create/update скидки пишет в AuditLog — поле createdBy в скидке есть, но систематический лог нужно проверить",
      },
    ],
  },
  {
    key: "sal",
    title: "Зарплата",
    icon: Wallet,
    color: "text-amber-600",
    reports: [
      {
        id: "SAL-12",
        name: "Мотивация администратора",
        data: [
          "Настройки бонусов администратора: за пробное / за продажу / за допродажу",
          "Пробное занятие: создатель",
          "Абонемент: создатель, флаг первичности",
          "Клиент: общее количество абонементов",
        ],
        status: "ok",
      },
      {
        id: "SAL-15",
        name: "Прогноз сдельной оплаты",
        data: [
          "Ставка ЗП: схема (за ученика / за занятие / фикс+за ученика)",
          "Будущие занятия из расписания",
          "Зачисления в группу: активные",
        ],
        status: "ok",
      },
      {
        id: "SAL-16",
        name: "Часы педагогов по дням",
        data: [
          "Посещение: хотя бы один отмеченный ученик",
          "Занятие: длительность, основной/заменяющий инструктор",
        ],
        status: "ok",
      },
      {
        id: "SAL-17",
        name: "Средняя ЗП педагогов",
        data: [
          "Сумма начислений (по посещениям)",
          "Отработанные часы",
        ],
        status: "ok",
      },
      {
        id: "SAL-18",
        name: "Расчёты с педагогами",
        data: [
          "Выплаты ЗП",
          "Премии и штрафы",
          "Начисления по посещениям",
        ],
        status: "ok",
      },
    ],
  },
  {
    key: "inv",
    title: "Склад",
    icon: Package,
    color: "text-rose-600",
    reports: [
      {
        id: "INV-06",
        name: "Остатки по филиалам и кабинетам",
        data: [
          "Остатки на складе филиала",
          "Остатки в кабинете",
          "Товар склада: название, единица измерения, цена",
        ],
        status: "ok",
      },
    ],
  },
]

// ───────────────────────────────────────────────────────────────────────────
// КОНФИГ ОФОРМЛЕНИЯ
// ───────────────────────────────────────────────────────────────────────────

const statusConfig: Record<Status, {
  label: string
  icon: typeof CheckCircle2
  badgeClass: string
  rowClass: string
}> = {
  ok: {
    label: "Данные есть",
    icon: CheckCircle2,
    badgeClass:
      "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-900",
    rowClass: "",
  },
  partial: {
    label: "Частично",
    icon: AlertTriangle,
    badgeClass:
      "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-900",
    rowClass: "bg-amber-50/40 dark:bg-amber-950/10",
  },
  missing: {
    label: "Не хватает",
    icon: XCircle,
    badgeClass:
      "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-900",
    rowClass: "bg-red-50/50 dark:bg-red-950/10",
  },
}

// ───────────────────────────────────────────────────────────────────────────
// КОМПОНЕНТЫ
// ───────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Status }) {
  const cfg = statusConfig[status]
  const Icon = cfg.icon
  return (
    <Badge variant="outline" className={`gap-1 ${cfg.badgeClass}`}>
      <Icon className="size-3" />
      {cfg.label}
    </Badge>
  )
}

function ReportRow({ report }: { report: Report }) {
  const cfg = statusConfig[report.status]
  return (
    <TableRow className={cfg.rowClass}>
      <TableCell className="whitespace-nowrap align-top font-mono text-xs text-muted-foreground">
        {report.id}
      </TableCell>
      <TableCell className="align-top font-medium whitespace-normal">
        {report.name}
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <ul className="ml-4 list-disc space-y-1 text-sm">
          {report.data.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </TableCell>
      <TableCell className="align-top whitespace-nowrap">
        <StatusBadge status={report.status} />
      </TableCell>
      <TableCell className="align-top whitespace-normal text-sm text-muted-foreground">
        {report.gap || (
          <span className="text-xs text-muted-foreground/50">—</span>
        )}
      </TableCell>
    </TableRow>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// СТРАНИЦА
// ───────────────────────────────────────────────────────────────────────────

export default function RepsPage() {
  const [filter, setFilter] = useState<"all" | Status>("all")

  const allReports = useMemo(
    () => modules.flatMap((m) => m.reports.map((r) => ({ ...r, module: m.key }))),
    [],
  )

  const counts = useMemo(() => {
    const c = { all: 0, ok: 0, partial: 0, missing: 0 }
    for (const r of allReports) {
      c.all += 1
      c[r.status] += 1
    }
    return c
  }, [allReports])

  const visibleModules = useMemo(() => {
    if (filter === "all") return modules
    return modules
      .map((m) => ({ ...m, reports: m.reports.filter((r) => r.status === filter) }))
      .filter((m) => m.reports.length > 0)
  }, [filter])

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div>
        <h1 className="text-2xl font-bold">Отчёты MVP × данные системы</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Сводка по всем отчётам, требуемым в MVP (1 июня 2026) — какие сущности и поля
          нужны и где есть пробелы в текущей реализации.
        </p>
      </div>

      {/* Метрики */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-lg border p-4 text-left transition-colors ${
            filter === "all" ? "border-foreground" : "hover:bg-muted/40"
          }`}
        >
          <p className="text-2xl font-bold">{counts.all}</p>
          <p className="text-xs text-muted-foreground">всего отчётов</p>
        </button>
        <button
          onClick={() => setFilter("ok")}
          className={`rounded-lg border p-4 text-left transition-colors ${
            filter === "ok"
              ? "border-green-500"
              : "hover:bg-green-50 dark:hover:bg-green-950/20"
          }`}
        >
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {counts.ok}
          </p>
          <p className="text-xs text-muted-foreground">данные есть</p>
        </button>
        <button
          onClick={() => setFilter("partial")}
          className={`rounded-lg border p-4 text-left transition-colors ${
            filter === "partial"
              ? "border-amber-500"
              : "hover:bg-amber-50 dark:hover:bg-amber-950/20"
          }`}
        >
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
            {counts.partial}
          </p>
          <p className="text-xs text-muted-foreground">частично</p>
        </button>
        <button
          onClick={() => setFilter("missing")}
          className={`rounded-lg border p-4 text-left transition-colors ${
            filter === "missing"
              ? "border-red-500"
              : "hover:bg-red-50 dark:hover:bg-red-950/20"
          }`}
        >
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">
            {counts.missing}
          </p>
          <p className="text-xs text-muted-foreground">не хватает</p>
        </button>
      </div>

      {/* Легенда */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-green-600" />
              <span className="font-medium">Данные есть</span>
              <span className="text-muted-foreground">— все поля присутствуют в схеме</span>
            </span>
            <span className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-600" />
              <span className="font-medium">Частично</span>
              <span className="text-muted-foreground">— отчёт можно построить, но часть колонок неполная</span>
            </span>
            <span className="flex items-center gap-2">
              <XCircle className="size-4 text-red-600" />
              <span className="font-medium">Не хватает</span>
              <span className="text-muted-foreground">— ключевые данные отсутствуют</span>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Таблицы по модулям */}
      {visibleModules.map((mod) => {
        const ModIcon = mod.icon
        return (
          <Card key={mod.key}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ModIcon className={`size-5 ${mod.color}`} />
                {mod.title}
                <Badge variant="secondary" className="ml-1 font-normal">
                  {mod.reports.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[110px]">ID</TableHead>
                    <TableHead className="w-[220px]">Отчёт</TableHead>
                    <TableHead>Требуемые данные</TableHead>
                    <TableHead className="w-[140px]">Статус</TableHead>
                    <TableHead className="w-[320px]">Чего не хватает</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mod.reports.map((r) => (
                    <ReportRow key={r.id} report={r} />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      })}

      {/* Сводный блок пробелов */}
      <Card className="border-amber-200 dark:border-amber-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-5 text-amber-600" />
            Что нужно добавить в схему БД
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="ml-4 list-decimal space-y-3 text-sm">
            <li>
              <span className="font-medium">Справочник «Причины отчисления»</span>
              <span className="text-muted-foreground">
                {" "}— модель <code className="rounded bg-muted px-1 py-0.5 text-xs">WithdrawalReason</code> с типом{" "}
                <em>«ушёл с направления»</em> / <em>«закончил курс»</em> / <em>«другое»</em> + страница{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">/settings/withdrawal-reasons</code>. Закроет CRM-23, CRM-29.
              </span>
            </li>
            <li>
              <span className="font-medium">
                Флаги «исключить из отчёта оттока» в абонементе
              </span>
              <span className="text-muted-foreground">
                {" "}— чекбоксы «отток по направлению» и «отток по педагогу» в форме отчисления.
                Закроет CRM-23, CRM-27, CRM-29.
              </span>
            </li>
            <li>
              <span className="font-medium">Enum для результата звонка</span>
              <span className="text-muted-foreground">
                {" "}— <code className="rounded bg-muted px-1 py-0.5 text-xs">CallResult</code>{" "}
                (пробное / продажа / отказ / не дозвонились / перезвон) + поле «дата закрытия кампании».
                Закроет CRM-33 / CALL-05.
              </span>
            </li>
            <li>
              <span className="font-medium">
                Проверка покрытия аудит-логом
              </span>
              <span className="text-muted-foreground">
                {" "}— убедиться, что бэкенд пишет в аудит при ручной правке суммы списания в посещении
                и при создании разовой скидки. Закроет FIN-31, FIN-32.
              </span>
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
