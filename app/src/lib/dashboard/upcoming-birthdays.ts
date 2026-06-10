import { type Prisma, type PrismaClient } from "@prisma/client"

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

const WINDOW_DAYS = 30
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
 * ДР не попадает в окно [today, today + WINDOW_DAYS] включительно.
 *
 * Считаем по дню/месяцу, игнорируя год рождения. 29 февраля в невисокосный
 * год JS нормализует в 1 марта — приемлемо для напоминалки.
 */
function upcoming(
  birth: Date,
  today: Date,
): { date: Date; turns: number; daysUntil: number } | null {
  const bMonth = birth.getUTCMonth()
  const bDay = birth.getUTCDate()
  const ty = today.getUTCFullYear()
  let candidate = new Date(Date.UTC(ty, bMonth, bDay))
  if (candidate.getTime() < today.getTime()) {
    candidate = new Date(Date.UTC(ty + 1, bMonth, bDay))
  }
  const daysUntil = Math.round((candidate.getTime() - today.getTime()) / DAY_MS)
  if (daysUntil < 0 || daysUntil > WINDOW_DAYS) return null
  const turns = candidate.getUTCFullYear() - birth.getUTCFullYear()
  return { date: candidate, turns, daysUntil }
}

/**
 * Виджет дашборда «Дни рождения»: дети (Ward, только с активным абонементом)
 * и сотрудники (Employee, действующие), чей день рождения попадает в окно
 * [сегодня, сегодня + 30 дней]. `today` — UTC-полночь сегодняшнего дня
 * (передаётся из server-компонента).
 */
export async function computeUpcomingBirthdays(
  db: DB,
  tenantId: string,
  today: Date,
): Promise<BirthdaysData> {
  // Ward не имеет soft-delete → отсекаем детей удалённых клиентов через client.
  // Показываем только детей с хотя бы одним активным абонементом.
  const [wards, employees] = await Promise.all([
    db.ward.findMany({
      where: {
        tenantId,
        birthDate: { not: null },
        client: { deletedAt: null },
        subscriptions: { some: { deletedAt: null, status: "active" } },
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
      },
      select: { id: true, firstName: true, lastName: true, middleName: true, birthDate: true },
    }),
  ])

  const children: BirthdayRow[] = []
  for (const w of wards) {
    if (!w.birthDate) continue
    const u = upcoming(w.birthDate, today)
    if (!u) continue
    children.push({
      id: w.id,
      fio: [w.lastName, w.firstName].filter(Boolean).join(" ") || "—",
      dateLabel: fmtDM(u.date),
      turnsLabel: ruYears(u.turns),
      daysUntil: u.daysUntil,
    })
  }
  children.sort((a, b) => a.daysUntil - b.daysUntil)

  const staff: BirthdayRow[] = []
  for (const e of employees) {
    if (!e.birthDate) continue
    const u = upcoming(e.birthDate, today)
    if (!u) continue
    staff.push({
      id: e.id,
      fio: [e.lastName, e.firstName, e.middleName].filter(Boolean).join(" ") || "—",
      dateLabel: fmtDM(u.date),
      turnsLabel: ruYears(u.turns),
      daysUntil: u.daysUntil,
    })
  }
  staff.sort((a, b) => a.daysUntil - b.daysUntil)

  return { children, staff }
}
