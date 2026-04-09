"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

/**
 * Карта сегментов URL → русские названия.
 * Ключ — сегмент пути (без слэшей), значение — отображаемое название.
 */
const SEGMENT_LABELS: Record<string, string> = {
  // Корень
  "": "Главная",

  // CRM
  crm: "CRM",
  leads: "Лиды",
  clients: "Клиенты",
  calls: "Обзвон",
  duplicates: "Дубликаты",
  import: "Импорт",

  // Финансы
  finance: "Финансы",
  payments: "Оплаты",
  expenses: "Расходы",
  "planned-expenses": "Плановые расходы",
  cash: "Касса",
  dds: "ДДС",
  debtors: "Должники",

  // Расписание
  schedule: "Расписание",
  calendar: "Произв. календарь",
  groups: "Группы",
  lessons: "Занятие",

  // Отчёты
  reports: "Отчёты",
  funnel: "Воронка продаж",
  "avg-check": "Средний чек",
  upsell: "Допродажи",
  churn: "Отток",
  "not-renewed": "Непродлённые",
  details: "Детализация",
  potential: "Потенциальный отток",
  attendance: "Посещения",
  visits: "Посещения",
  unmarked: "Неотмеченные дети",
  capacity: "Свободные места",
  salary: "Зарплата",
  "by-instructor": "По педагогам",
  revenue: "Выручка",
  pnl: "P&L",
  "pnl-directions": "P&L по направлениям",

  // Прочее
  staff: "Сотрудники",
  tasks: "Задачи",
  stock: "Склад",
  settings: "Настройки",
  "discount-templates": "Шаблоны скидок",
  "admin-bonus": "Бонусы админов",
  channels: "Каналы привлечения",
  "absence-reasons": "Причины пропусков",
  integrations: "Интеграции",
  billing: "Подписка",
  roadmap: "Roadmap",
  changelog: "Changelog",
}

/** Составные пути, для которых нужен особый лейбл (context-dependent) */
const PATH_LABELS: Record<string, string> = {
  "/reports/finance": "Финансовые",
  "/reports/crm": "CRM",
  "/reports/churn": "Отток",
  "/reports/attendance": "Посещения",
  "/reports/schedule": "Расписание",
  "/reports/salary": "Зарплата",
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export function AutoBreadcrumbs() {
  const pathname = usePathname()

  // Главная — не показываем крошки
  if (pathname === "/") return null

  const segments = pathname.split("/").filter(Boolean)

  // Собираем крошки: [{ label, href }]
  const crumbs: { label: string; href: string }[] = [
    { label: "Главная", href: "/" },
  ]

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    const href = "/" + segments.slice(0, i + 1).join("/")

    // Пропускаем UUID/числовые ID — они не нужны как отдельные крошки
    if (isUuid(segment) || /^\d+$/.test(segment)) {
      continue
    }

    // Сначала пробуем составной путь
    const label = PATH_LABELS[href] || SEGMENT_LABELS[segment]

    if (label) {
      crumbs.push({ label, href })
    } else {
      // Неизвестный сегмент — показываем как есть
      crumbs.push({ label: segment, href })
    }
  }

  // Если только "Главная" — не показываем
  if (crumbs.length <= 1) return null

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <span key={crumb.href} className="inline-flex items-center gap-1.5">
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={<Link href={crumb.href} />}>
                    {crumb.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </span>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
