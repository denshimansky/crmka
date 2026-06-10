import { Prisma, type PrismaClient } from "@prisma/client"

type DB = PrismaClient | Prisma.TransactionClient

export interface ActiveSubsRow {
  branchId: string
  branch: string
  /** Количество абонементов за месяц — активированных (списание/оплата) в месяце. */
  created: number
  /** Продлённые — из активированных те, чей клиент был активен в прошлом месяце. */
  renewed: number
  /** Количество активных на конец — абонементы со статусом active прямо сейчас. */
  activeNow: number
}

export interface ActiveSubsData {
  rows: ActiveSubsRow[]
  totals: { created: number; renewed: number; activeNow: number }
}

/**
 * Виджет дашборда «Активные абонементы» — по филиалам за выбранный месяц.
 *
 * Определения (согласованы с владельцем 10.06.2026):
 *   • «Количество абонементов за месяц» — абонемент засчитывается, если в
 *     выбранном месяце по нему было хотя бы 1 занятие со списанием
 *     (Attendance с типом partOfFact = «посетил/прогулял») ИЛИ оплата
 *     (Payment incoming, привязанный к абонементу). Выписанные, но «мёртвые»
 *     (без посещений и оплат) абонементы НЕ считаются.
 *   • «Продлённые» — из активированных в этом месяце те, чей клиент был
 *     активен и в ПРОШЛОМ месяце (та же логика активности, применённая к
 *     предыдущему месяцу).
 *   • «Количество активных на конец месяца» — абонементы со статусом active
 *     на текущий момент («активные на минуту сейчас»). Для прошлых месяцев
 *     это тоже текущий срез, а не исторический.
 *
 * Группировка по филиалу — через Subscription → group → branch.
 */
export async function computeActiveSubscriptionsByBranch(
  db: DB,
  tenantId: string,
  year: number,
  month: number,
): Promise<ActiveSubsData> {
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
  const prevStart = new Date(Date.UTC(year, month - 2, 1))
  const prevEnd = new Date(Date.UTC(year, month - 1, 0, 23, 59, 59, 999))

  const factType = { attendanceType: { partOfFact: true } }

  const [attCur, payCur, attPrev, payPrev, activeNow] = await Promise.all([
    // Текущий месяц: занятия со списанием → активированные абонементы.
    // isPending — заглушки разовых посещений (ещё не отмечены, списания нет),
    // их не считаем активацией.
    db.attendance.findMany({
      where: {
        tenantId,
        subscriptionId: { not: null },
        isPending: false,
        ...factType,
        lesson: { date: { gte: monthStart, lte: monthEnd } },
      },
      select: { subscriptionId: true },
    }),
    // Текущий месяц: оплаты абонементов → активированные абонементы.
    db.payment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        type: "incoming",
        subscriptionId: { not: null },
        date: { gte: monthStart, lte: monthEnd },
      },
      select: { subscriptionId: true },
    }),
    // Прошлый месяц: клиенты с занятиями со списанием.
    db.attendance.findMany({
      where: {
        tenantId,
        subscriptionId: { not: null },
        isPending: false,
        ...factType,
        lesson: { date: { gte: prevStart, lte: prevEnd } },
      },
      select: { clientId: true },
    }),
    // Прошлый месяц: клиенты с оплатами абонементов.
    db.payment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        type: "incoming",
        subscriptionId: { not: null },
        date: { gte: prevStart, lte: prevEnd },
      },
      select: { clientId: true },
    }),
    // Активные на текущий момент.
    db.subscription.findMany({
      where: { tenantId, deletedAt: null, status: "active" },
      select: {
        group: { select: { branchId: true, branch: { select: { name: true } } } },
      },
    }),
  ])

  const activatedIds = new Set<string>()
  for (const a of attCur) if (a.subscriptionId) activatedIds.add(a.subscriptionId)
  for (const p of payCur) if (p.subscriptionId) activatedIds.add(p.subscriptionId)

  const prevActiveClients = new Set<string>()
  for (const a of attPrev) prevActiveClients.add(a.clientId)
  for (const p of payPrev) if (p.clientId) prevActiveClients.add(p.clientId)

  // Абонементы, активированные в этом месяце, — с клиентом и филиалом.
  const activatedSubs =
    activatedIds.size > 0
      ? await db.subscription.findMany({
          where: { tenantId, id: { in: [...activatedIds] } },
          select: {
            clientId: true,
            group: { select: { branchId: true, branch: { select: { name: true } } } },
          },
        })
      : []

  const map = new Map<string, ActiveSubsRow>()
  function bucket(branchId: string, branchName: string): ActiveSubsRow {
    let row = map.get(branchId)
    if (!row) {
      row = { branchId, branch: branchName, created: 0, renewed: 0, activeNow: 0 }
      map.set(branchId, row)
    }
    return row
  }

  for (const s of activatedSubs) {
    const row = bucket(s.group.branchId, s.group.branch.name)
    row.created += 1
    if (prevActiveClients.has(s.clientId)) row.renewed += 1
  }
  for (const s of activeNow) {
    bucket(s.group.branchId, s.group.branch.name).activeNow += 1
  }

  const rows = [...map.values()]
    .filter((r) => r.created > 0 || r.activeNow > 0)
    .sort((a, b) => a.branch.localeCompare(b.branch, "ru"))

  const totals = rows.reduce(
    (acc, r) => ({
      created: acc.created + r.created,
      renewed: acc.renewed + r.renewed,
      activeNow: acc.activeNow + r.activeNow,
    }),
    { created: 0, renewed: 0, activeNow: 0 }
  )

  return { rows, totals }
}
