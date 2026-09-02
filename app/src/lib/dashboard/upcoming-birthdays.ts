import { type Prisma, type PrismaClient } from "@prisma/client"
import { scopeEmployee, type BranchScope } from "@/lib/branch-scope"
import { scopeClientByBranch } from "@/lib/client-segments"

type DB = PrismaClient | Prisma.TransactionClient

export interface BirthdayRow {
  id: string
  fio: string
  /** День и месяц ближайшего дня рождения, «15.06». */
  dateLabel: string
  /** «5 лет» — сколько исполнится на ближайший ДР. */
  turnsLabel: string
  /** Дней до ближайшего ДР (для сортировки). */
  daysUntil: number
}

export interface BirthdaysData {
  children: BirthdayRow[]
  staff: BirthdayRow[]
}

/**
 * Окна виджета. Дети идут ИЗ ВСЕЙ БАЗЫ (а не только с активным абонементом),
 * поэтому их окно узкое — неделя: это список «кого поздравить на днях».
 * Сотрудников мало, им оставлено прежнее месячное окно (успеть с подарком).
 */
export const CHILD_WINDOW_DAYS = 7
export const STAFF_WINDOW_DAYS = 30

/**
 * Базы, из которых детей не поздравляем: чёрный список, архив, нецелевые.
 * Остальные попадают в виджет — действующие, выбывшие, потенциальные и лиды
 * (то же правило, что у «Обзвона по задачам», call-campaigns/filter.ts).
 * Проверено на проде: значения clientStatus="archived" в базе отсутствуют,
 * «архив» живёт только в воронке, поэтому второго условия не нужно.
 */
export const BIRTHDAY_EXCLUDED_FUNNEL_STATUSES = [
  "blacklisted",
  "archived",
  "non_target",
] as const

const DAY_MS = 86_400_000

/** Русское склонение слова «год» после числа: 1 год, 2 года, 5 лет. */
function ruYears(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return `${n} год`
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} года`
  return `${n} лет`
}

function fmtDM(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/**
 * Ближайший день рождения (>= today) и сколько лет исполнится. null — если
 * ДР не попадает в окно [today, today + windowDays] включительно.
 *
 * Считаем по дню/месяцу, игнорируя год рождения. 29 февраля в невисокосный
 * год JS нормализует в 1 марта — приемлемо для напоминалки.
 */
export function upcomingBirthday(
  birth: Date,
  today: Date,
  windowDays: number,
): { date: Date; turns: number; daysUntil: number } | null {
  const bMonth = birth.getUTCMonth()
  const bDay = birth.getUTCDate()
  const ty = today.getUTCFullYear()
  let candidate = new Date(Date.UTC(ty, bMonth, bDay))
  if (candidate.getTime() < today.getTime()) {
    candidate = new Date(Date.UTC(ty + 1, bMonth, bDay))
  }
  const daysUntil = Math.round((candidate.getTime() - today.getTime()) / DAY_MS)
  if (daysUntil < 0 || daysUntil > windowDays) return null
  const turns = candidate.getUTCFullYear() - birth.getUTCFullYear()
  return { date: candidate, turns, daysUntil }
}

/**
 * Виджет дашборда «Дни рождения»: дети (Ward из ВСЕХ баз, кроме чёрного
 * списка, архива и нецелевых — окно 7 дней) и сотрудники (Employee,
 * действующие — окно 30 дней). `today` — UTC-полночь сегодняшнего дня
 * (передаётся из server-компонента, всегда реальное сегодня, а не выбранный
 * на дашборде месяц).
 */
export async function computeUpcomingBirthdays(
  db: DB,
  tenantId: string,
  today: Date,
  scope: BranchScope = { mode: "all" },
): Promise<BirthdaysData> {
  // ADM-04: скоуп-админ видит ДР детей своих филиалов и ДР сотрудников своего
  // филиала. Раньше филиал ребёнка выводился через активный абонемент — без
  // требования абонемента этот путь мёртв, поэтому скоупим через РОДИТЕЛЯ тем
  // же хелпером, что и страница «Клиенты» (ручная привязка филиала + живой
  // абонемент). Пустой скоуп (владелец / админ со всеми филиалами) не
  // добавляем вовсе: `{ client: {} }` в фильтре Prisma роняет условие молча.
  const clientScope = scopeClientByBranch(scope)
  const clientWhere: Prisma.ClientWhereInput = {
    // tenantId здесь не для безопасности (он уже есть у ward), а для плана
    // запроса: без него Prisma сканирует таблицу clients поперёк всех тенантов.
    tenantId,
    deletedAt: null,
    funnelStatus: { notIn: [...BIRTHDAY_EXCLUDED_FUNNEL_STATUSES] },
  }
  if (Object.keys(clientScope).length > 0) clientWhere.AND = [clientScope]

  // Ward не имеет soft-delete → отсекаем детей удалённых клиентов через client.
  const [wards, employees] = await Promise.all([
    db.ward.findMany({
      where: {
        tenantId,
        birthDate: { not: null },
        client: clientWhere,
      },
      select: { id: true, firstName: true, lastName: true, birthDate: true },
    }),
    db.employee.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        type: "ACTIVE",
        birthDate: { not: null },
        ...scopeEmployee(scope),
      },
      select: { id: true, firstName: true, lastName: true, middleName: true, birthDate: true },
    }),
  ])

  const children: BirthdayRow[] = []
  for (const w of wards) {
    if (!w.birthDate) continue
    const u = upcomingBirthday(w.birthDate, today, CHILD_WINDOW_DAYS)
    if (!u) continue
    children.push({
      id: w.id,
      fio: [w.lastName, w.firstName].filter(Boolean).join(" ") || "—",
      dateLabel: fmtDM(u.date),
      turnsLabel: ruYears(u.turns),
      daysUntil: u.daysUntil,
    })
  }
  children.sort((a, b) => a.daysUntil - b.daysUntil || a.fio.localeCompare(b.fio, "ru"))

  const staff: BirthdayRow[] = []
  for (const e of employees) {
    if (!e.birthDate) continue
    const u = upcomingBirthday(e.birthDate, today, STAFF_WINDOW_DAYS)
    if (!u) continue
    staff.push({
      id: e.id,
      fio: [e.lastName, e.firstName, e.middleName].filter(Boolean).join(" ") || "—",
      dateLabel: fmtDM(u.date),
      turnsLabel: ruYears(u.turns),
      daysUntil: u.daysUntil,
    })
  }
  staff.sort((a, b) => a.daysUntil - b.daysUntil || a.fio.localeCompare(b.fio, "ru"))

  return { children, staff }
}
