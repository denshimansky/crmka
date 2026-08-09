import type { Prisma } from "@prisma/client"
import type { PrismaClient } from "@prisma/client"
import { scopeSubscription, type BranchScope } from "@/lib/branch-scope"

/**
 * Единая «Сумма абонементов» месяца для трёх карточек дашборда и одноимённых
 * отчётов — «Ожидаемые поступления», «Отработанные», «Прогноз прибыли».
 * Спецификация Ани (09.08.2026, см. память project_dashboard_three_cards_unified_subamount):
 *
 * Набор — ВСЕ абонементы месяца, любого статуса (active/pending/closed/withdrawn),
 * любого клиента, ВКЛЮЧАЯ воронку (первые продажи по заявке «Ожидание оплаты»,
 * ещё не оплаченные). Календарь — по periodYear/Month; пакеты — по пересечению
 * действия пакета с месяцем.
 *
 * «Сумма абонемента» (одинакова во всех трёх карточках):
 *   - active/pending  → finalAmount (выписанная сумма);
 *   - closed/withdrawn → chargedAmount (по факту отработанного: выписан на 3000,
 *     отходил на 1000 → в «Сумму» идёт 1000).
 *
 * «Долг» (Ожидаемые поступления):
 *   - active/pending  → max(0, balance) (остаток к оплате);
 *   - closed/withdrawn → долг закрытия. При закрытии sub.balance обнуляется, а
 *     долг переносится на баланс родителя проводкой subscription_closed_refund
 *     (см. reconcile-closure.ts). Достаём его отсюда: net по этим проводкам, если
 *     отрицателен → это долг.
 */
export interface SubMonthFigure {
  id: string
  clientId: string
  branchId: string | null
  branchName: string | null
  directionId: string
  directionName: string
  status: string
  /** Сумма абонемента: active/pending → finalAmount; closed/withdrawn → chargedAmount. */
  subAmount: number
  /** Долг: active/pending → max(0, balance); closed/withdrawn → долг закрытия с баланса. */
  expected: number
  /** Отработано (накопленные списания за проведённые занятия). */
  worked: number
  /** Скидка абонемента. */
  discount: number
}

const TERMINAL_STATUSES = new Set(["closed", "withdrawn"])

export async function computeMonthSubscriptionFigures(
  db: PrismaClient | Prisma.TransactionClient,
  opts: {
    tenantId: string
    year: number
    month: number
    /** Филиальный scope сессии (ADM-04). Не передан — без ограничения по филиалам. */
    scope?: BranchScope
    /** Ограничить одним филиалом (для отчётов с ?branchId=). */
    branchId?: string | null
    /** Организация с пакетными абонементами: период матчится по пересечению. */
    isPackageOrg?: boolean
  },
): Promise<SubMonthFigure[]> {
  const { tenantId, year, month } = opts
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEndDt = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

  const where: Prisma.SubscriptionWhereInput = {
    tenantId,
    deletedAt: null,
    // Статус НЕ фильтруем: набор включает и воронку (pending), и действующие
    // (active), и закрытые/выбывшие — их «Сумма» считается по факту.
    ...(opts.scope ? scopeSubscription(opts.scope) : {}),
    ...(opts.branchId ? { group: { branchId: opts.branchId } } : {}),
    ...(opts.isPackageOrg
      ? {
          type: "package",
          startDate: { lte: monthEndDt },
          OR: [{ expiresAt: null }, { expiresAt: { gte: monthStart } }],
        }
      : { periodYear: year, periodMonth: month }),
  }

  const subs = await db.subscription.findMany({
    where,
    select: {
      id: true,
      clientId: true,
      status: true,
      finalAmount: true,
      chargedAmount: true,
      balance: true,
      discountAmount: true,
      directionId: true,
      direction: { select: { name: true } },
      group: { select: { branch: { select: { id: true, name: true } } } },
    },
  })

  // Долг закрытия для closed/withdrawn — с баланса родителя (у самих абонементов
  // balance обнулён при закрытии). Net по проводкам subscription_closed_refund:
  // отрицательный net = долг.
  const terminalIds = subs.filter((s) => TERMINAL_STATUSES.has(s.status)).map((s) => s.id)
  const closureDebtBySub = new Map<string, number>()
  if (terminalIds.length > 0) {
    const txns = await db.clientBalanceTransaction.groupBy({
      by: ["subscriptionId"],
      where: {
        tenantId,
        subscriptionId: { in: terminalIds },
        type: "subscription_closed_refund",
      },
      _sum: { amount: true },
    })
    for (const t of txns) {
      if (!t.subscriptionId) continue
      const net = Number(t._sum.amount ?? 0)
      if (net < 0) closureDebtBySub.set(t.subscriptionId, -net)
    }
  }

  return subs.map((s) => {
    const terminal = TERMINAL_STATUSES.has(s.status)
    const finalAmount = Number(s.finalAmount)
    const charged = Number(s.chargedAmount)
    const balance = Number(s.balance)
    return {
      id: s.id,
      clientId: s.clientId,
      branchId: s.group.branch?.id ?? null,
      branchName: s.group.branch?.name ?? null,
      directionId: s.directionId,
      directionName: s.direction.name,
      status: s.status,
      subAmount: terminal ? charged : finalAmount,
      expected: terminal ? (closureDebtBySub.get(s.id) ?? 0) : Math.max(0, balance),
      worked: charged,
      discount: Number(s.discountAmount),
    }
  })
}
