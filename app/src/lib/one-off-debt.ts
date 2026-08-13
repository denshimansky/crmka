import { db } from "@/lib/db"

export interface BalanceDebtBreakdown {
  /** Долг за разовые посещения без оплаты — реальный долг «здесь и сейчас». */
  oneOff: number
  /** Долг, приехавший с импортом базы (остатки/лиды) — происхождение неизвестно. */
  imported: number
  /** Прочий минус баланса: перенос между абонементами / закрытие абонемента с долгом. */
  other: number
}

// Чистая раскладка величины минусового баланса на три источника (эвристика на
// знаках ledger-нетто). Приоритет отнесения: сначала разовые (живой долг), затем
// импорт, затем остаток — перенос/закрытие. Выделено отдельно, чтобы покрыть
// логику unit-тестами без БД.
//   debt      — абсолютная величина минуса баланса (>0);
//   oneOffNet — сколько минуса объясняют разовые (personal_lesson_charge за вычетом
//               возвратов разовых), может быть <= 0;
//   importNet — нетто импортных correction-проводок, может быть + (кредит) или −.
export function splitBalanceDebt(
  debt: number,
  oneOffNet: number,
  importNet: number,
): BalanceDebtBreakdown {
  if (debt <= 0) return { oneOff: 0, imported: 0, other: 0 }
  const oneOff = Math.min(debt, Math.max(0, oneOffNet))
  const imported = Math.min(debt - oneOff, Math.max(0, -importNet))
  const other = Math.max(0, debt - oneOff - imported)
  return { oneOff, imported, other }
}

// Метки источников долга по балансу — в порядке отображения, пустые отсеяны.
// «долг после импорта» намеренно вместо «перенос/закрытие»: для импортированных
// клиентов мы не знаем реальную природу долга, а не выдумываем перенос/закрытие.
export function balanceDebtLabels(b: BalanceDebtBreakdown): string[] {
  const EPS = 0.001
  return [
    b.oneOff > EPS ? "разовые посещения" : null,
    b.imported > EPS ? "долг после импорта" : null,
    b.other > EPS ? "перенос/закрытие" : null,
  ].filter((x): x is string => x !== null)
}

// Раскладка минусового clientBalance на источники по всем переданным клиентам.
// Возвращает записи только для клиентов с отрицательным балансом.
// Долг за разовые = personal_lesson_charge за вычетом возвратов разовых
// (attendance_revert без абонемента, положительные). Абонементные откаты
// (lesson_refund) — всегда отрицательные, поэтому знак надёжно разделяет семантики.
// Импортный долг = нетто correction-проводок импорта (comment начинается с «Импорт» —
// покрывает «Импорт остатков…», «Импорт остатков из 1С…», «Импорт лидов…»); прочие
// correction (скидки-бонусы, правки платежей) под префикс не подпадают.
export async function balanceDebtBreakdownByClient(
  tenantId: string,
  clients: { id: string; clientBalance: unknown }[],
): Promise<Map<string, BalanceDebtBreakdown>> {
  const result = new Map<string, BalanceDebtBreakdown>()
  const neg = clients.filter((c) => Number(c.clientBalance) < 0)
  if (neg.length === 0) return result

  const ids = neg.map((c) => c.id)
  const [charges, reverts, imports] = await Promise.all([
    db.clientBalanceTransaction.groupBy({
      by: ["clientId"],
      where: { tenantId, clientId: { in: ids }, type: "personal_lesson_charge" },
      _sum: { amount: true },
    }),
    db.clientBalanceTransaction.groupBy({
      by: ["clientId"],
      where: {
        tenantId,
        clientId: { in: ids },
        type: "attendance_revert",
        subscriptionId: null,
        amount: { gt: 0 },
      },
      _sum: { amount: true },
    }),
    db.clientBalanceTransaction.groupBy({
      by: ["clientId"],
      where: {
        tenantId,
        clientId: { in: ids },
        type: "correction",
        comment: { startsWith: "Импорт" },
      },
      _sum: { amount: true },
    }),
  ])

  const oneOffNet = new Map<string, number>()
  for (const g of charges) oneOffNet.set(g.clientId, -Number(g._sum.amount || 0))
  for (const g of reverts) {
    oneOffNet.set(g.clientId, (oneOffNet.get(g.clientId) || 0) - Number(g._sum.amount || 0))
  }
  const importNet = new Map<string, number>()
  for (const g of imports) importNet.set(g.clientId, Number(g._sum.amount || 0))

  for (const c of neg) {
    const debt = -Number(c.clientBalance)
    result.set(c.id, splitBalanceDebt(debt, oneOffNet.get(c.id) || 0, importNet.get(c.id) || 0))
  }
  return result
}

// Долг за разовые посещения (совместимость: /finance/debtors). Возвращает только
// клиентов с oneOff > 0 — как прежде. Источник расчёта общий с раскладкой карточки.
export async function oneOffDebtByClient(
  tenantId: string,
  clients: { id: string; clientBalance: unknown }[],
): Promise<Map<string, number>> {
  const breakdown = await balanceDebtBreakdownByClient(tenantId, clients)
  const result = new Map<string, number>()
  for (const [id, b] of breakdown) if (b.oneOff > 0) result.set(id, b.oneOff)
  return result
}
