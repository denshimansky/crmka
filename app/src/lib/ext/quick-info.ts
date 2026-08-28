import { db } from "@/lib/db"
import { formatMoney } from "@/lib/currency"
import { lessonsWord } from "@/lib/plural"
import { scopeClientByBranch } from "@/lib/client-segments"
import type { ExtContext } from "@/lib/ext-auth"

/**
 * «Вставить справку» — готовые куски текста для ответа родителю
 * (docs/messenger-extension.md §5, Фаза 3).
 *
 * Сотрудник нажимает кнопку в панели, текст попадает В ПОЛЕ ВВОДА мессенджера,
 * отправляет человек. Автоотправки нет и не будет — это принцип-щит спеки (§3):
 * ровно он выводит расширение из-под правил сторов про массовые рассылки.
 *
 * Отсюда требования к тексту: он уходит родителю как есть, поэтому пишем
 * по-человечески (без внутренних терминов CRM), без ПДн других семей и без
 * сумм, которые администратор не собирался показывать. Формат «одно занятие —
 * одна строка»: в мессенджере это читается, а таблицы разъезжаются.
 *
 * Форматирование вынесено в чистые функции и покрыто тестами: текст уходит
 * клиенту, ошибка тут видна не нам, а родителю.
 */

/** Готовый блок для вставки. */
export interface QuickInfoBlock {
  /** Ключ для панели (schedule / subscriptions / balance). */
  key: string
  /** Подпись кнопки. */
  title: string
  /** Текст, который уедет в поле ввода мессенджера. */
  text: string
}

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]

const MONTHS_IN = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
]

/** «2026-09-01» → «01.09 (пн)». Разбираем строку, а не Date: сдвиг зоны сдвинул бы день. */
export function formatLessonDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")} (${weekday})`
}

/**
 * Название кабинета для родителя. Приписку «каб.» добавляем только если её нет
 * в самом названии: у центров кабинеты часто названы «1 кабинет» или
 * «Кабинет 2», и получалось «каб. 1 кабинет».
 */
export function formatRoom(room: string | null): string | null {
  const name = room?.trim()
  if (!name) return null
  return /каб/i.test(name) ? name : `каб. ${name}`
}

/** Занятие одной строкой: «01.09 (пн) 17:00 — Ментальная арифметика, каб. Синий». */
export function formatLessonLine(lesson: {
  date: string
  startTime: string
  direction: string | null
  room: string | null
}): string {
  const tail = [lesson.direction, formatRoom(lesson.room)].filter(Boolean).join(", ")
  const head = `${formatLessonDate(lesson.date)} ${lesson.startTime}`
  return tail ? `${head} — ${tail}` : head
}

/**
 * Расписание: по строке на занятие, с именем ребёнка, когда детей несколько.
 * Пусто (null) — вставлять нечего, и кнопку показывать не надо.
 */
export function formatScheduleText(
  wards: Array<{
    name: string
    lessons: Array<{ date: string; startTime: string; direction: string | null; room: string | null }>
  }>,
  opts: { showNames: boolean },
): string | null {
  const parts: string[] = []
  for (const ward of wards) {
    if (ward.lessons.length === 0) continue
    const head = opts.showNames ? `Ближайшие занятия, ${ward.name}:` : "Ближайшие занятия:"
    parts.push([head, ...ward.lessons.map((l) => formatLessonLine(l))].join("\n"))
  }
  return parts.length ? parts.join("\n\n") : null
}

/**
 * Остаток по абонементу. Долг показываем только если он есть: напоминание об
 * оплате — отдельное решение администратора, а не побочный эффект справки.
 */
export function formatSubscriptionsText(
  wards: Array<{
    name: string
    subscriptions: Array<{
      direction: string | null
      periodYear: number | null
      periodMonth: number | null
      totalLessons: number
      remainingLessons: number
      debt: number
    }>
  }>,
  opts: { showNames: boolean; currency?: string | null },
): string | null {
  const lines: string[] = []
  for (const ward of wards) {
    for (const sub of ward.subscriptions) {
      const who = opts.showNames ? `${ward.name}, ` : ""
      const period =
        sub.periodYear && sub.periodMonth ? ` в ${MONTHS_IN[sub.periodMonth - 1]}` : ""
      const what = sub.direction ?? "занятия"
      lines.push(
        `${who}${what}${period}: оплачено ${sub.totalLessons} ${lessonsWord(sub.totalLessons)}, ` +
          `осталось ${sub.remainingLessons}.` +
          (sub.debt > 0 ? ` К оплате ${formatMoney(sub.debt, opts.currency)}.` : ""),
      )
    }
  }
  return lines.length ? lines.join("\n") : null
}

/** Деньги на балансе клиента: минус — это долг (в отличие от Subscription.balance). */
export function formatBalanceText(balance: number, currency?: string | null): string {
  if (balance < 0) return `Задолженность: ${formatMoney(-balance, currency)}.`
  if (balance > 0) return `На балансе: ${formatMoney(balance, currency)}.`
  return "На балансе: 0."
}

/** Сколько ближайших занятий показываем — дальше родителю уже не нужно. */
const UPCOMING_LESSONS = 5

/** Один подопечный с тем, что о нём нужно знать для текста родителю. */
export interface WardFacts {
  name: string
  lessons: Array<{ date: string; startTime: string; direction: string | null; room: string | null }>
  subscriptions: Array<{
    direction: string | null
    periodYear: number | null
    periodMonth: number | null
    totalLessons: number
    remainingLessons: number
    debt: number
  }>
}

/**
 * Факты о клиенте, из которых собирается любой текст для родителя — и справка,
 * и раскрытые плейсхолдеры шаблонов. Единый источник, чтобы «остаток» в
 * шаблоне и «остаток» в справке не разошлись со временем.
 */
export interface ClientFacts {
  clientName: string
  parentFirstName: string | null
  branchName: string | null
  balance: number
  currency: string | null
  /** Имена показываем только когда детей несколько — иначе это шум. */
  showNames: boolean
  wards: WardFacts[]
}

/**
 * Собрать факты о клиенте. null — клиента нет или он вне филиалов сотрудника
 * (не подтверждаем существование, как и в client-card).
 */
export async function collectClientFacts(
  ctx: ExtContext,
  clientId: string,
): Promise<ClientFacts | null> {
  const client = await db.client.findFirst({
    where: {
      id: clientId,
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...scopeClientByBranch(ctx.branchScope),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      patronymic: true,
      clientBalance: true,
      branch: { select: { name: true } },
      wards: {
        orderBy: [{ firstName: "asc" }, { createdAt: "asc" }],
        select: { id: true, firstName: true, lastName: true },
      },
    },
  })
  if (!client) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const currentYear = today.getFullYear()
  const currentMonth = today.getMonth() + 1

  const [organization, enrollments, subscriptions] = await Promise.all([
    db.organization.findUnique({ where: { id: ctx.tenantId }, select: { currency: true } }),
    db.groupEnrollment.findMany({
      where: { tenantId: ctx.tenantId, clientId, isActive: true, deletedAt: null },
      select: { wardId: true, groupId: true },
    }),
    // Критерий активности — как в карточке: пакетные абонементы (periodYear = NULL)
    // живут по expiresAt и наивным фильтром по периоду выпали бы.
    db.subscription.findMany({
      where: {
        tenantId: ctx.tenantId,
        clientId,
        deletedAt: null,
        withdrawalDate: null,
        status: { in: ["pending", "active"] },
        OR: [
          { periodYear: null },
          { periodYear: { gt: currentYear } },
          { periodYear: currentYear, periodMonth: { gte: currentMonth } },
        ],
      },
      select: {
        id: true,
        wardId: true,
        periodYear: true,
        periodMonth: true,
        totalLessons: true,
        balance: true,
        direction: { select: { name: true } },
      },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
      take: 20,
    }),
  ])

  const groupIds = [...new Set(enrollments.map((e) => e.groupId))]
  const upcoming = groupIds.length
    ? await db.lesson.findMany({
        where: {
          tenantId: ctx.tenantId,
          groupId: { in: groupIds },
          date: { gte: today },
          status: "scheduled",
        },
        select: {
          date: true,
          startTime: true,
          groupId: true,
          group: {
            select: { direction: { select: { name: true } }, room: { select: { name: true } } },
          },
        },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        take: 60,
      })
    : []

  // Списанные занятия — тем же способом, что в карточке клиента.
  const subIds = subscriptions.map((s) => s.id)
  const consumed = subIds.length
    ? await db.attendance.groupBy({
        by: ["subscriptionId"],
        where: {
          tenantId: ctx.tenantId,
          subscriptionId: { in: subIds },
          attendanceType: { chargesSubscription: true },
        },
        _count: { _all: true },
      })
    : []
  const consumedMap = new Map(consumed.map((c) => [c.subscriptionId, c._count._all]))

  const groupsByWard = new Map<string | null, Set<string>>()
  for (const e of enrollments) {
    if (!groupsByWard.has(e.wardId)) groupsByWard.set(e.wardId, new Set())
    groupsByWard.get(e.wardId)!.add(e.groupId)
  }

  const soleWard = client.wards.length === 1
  const showNames = client.wards.length > 1

  const wards = client.wards.map((ward) => {
    // Исторические записи без wardId относим к единственному ребёнку — иначе у
    // него пусто, хотя занятия есть (импорт, старые зачисления).
    const wardGroups = groupsByWard.get(ward.id) ?? (soleWard ? groupsByWard.get(null) : undefined)
    const name = [ward.firstName, ward.lastName].filter(Boolean).join(" ").trim() || "ребёнок"

    return {
      name,
      lessons: upcoming
        .filter((l) => wardGroups?.has(l.groupId))
        .slice(0, UPCOMING_LESSONS)
        .map((l) => ({
          date: l.date.toISOString().slice(0, 10),
          startTime: l.startTime,
          direction: l.group?.direction?.name ?? null,
          room: l.group?.room?.name ?? null,
        })),
      subscriptions: subscriptions
        .filter((s) => s.wardId === ward.id || (soleWard && s.wardId === null))
        .map((s) => ({
          direction: s.direction?.name ?? null,
          periodYear: s.periodYear,
          periodMonth: s.periodMonth,
          totalLessons: s.totalLessons,
          remainingLessons: Math.max(0, s.totalLessons - (consumedMap.get(s.id) ?? 0)),
          // Долг по абонементу — положительный balance («сколько осталось оплатить»).
          debt: Math.max(0, Number(s.balance)),
        })),
    }
  })

  return {
    clientName:
      [client.lastName, client.firstName, client.patronymic].filter(Boolean).join(" ").trim() ||
      "Без имени",
    parentFirstName: client.firstName?.trim() || null,
    branchName: client.branch?.name ?? null,
    // Деньги клиента: минус = долг.
    balance: Number(client.clientBalance),
    currency: organization?.currency ?? null,
    showNames,
    wards,
  }
}

/**
 * Справки для панели: расписание, остаток по абонементу, баланс.
 * null — клиента нет или он вне филиалов сотрудника.
 */
export async function buildQuickInfo(
  ctx: ExtContext,
  clientId: string,
): Promise<{ blocks: QuickInfoBlock[] } | null> {
  const facts = await collectClientFacts(ctx, clientId)
  if (!facts) return null

  const { currency, showNames, wards } = facts
  const blocks: QuickInfoBlock[] = []

  const schedule = formatScheduleText(wards, { showNames })
  if (schedule) blocks.push({ key: "schedule", title: "Расписание", text: schedule })

  const subs = formatSubscriptionsText(wards, { showNames, currency })
  if (subs) blocks.push({ key: "subscriptions", title: "Абонемент", text: subs })

  blocks.push({ key: "balance", title: "Баланс", text: formatBalanceText(facts.balance, currency) })

  return { blocks }
}
