import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { scopeApplication, type BranchScope } from "@/lib/branch-scope"
import { scopeClientByBranch } from "@/lib/client-segments"

// «Сводная таблица воронки продаж» — снимок «на сейчас»: сколько активных заявок
// стоит на каждом этапе воронки, в разрезе Филиал → Направление. Плюс столбец
// «Связь» — клиенты с назначенной датой следующего контакта (как во вкладке
// Продажи → Связь). Этапы = Application.stage (тот же источник, что и раздел
// «Продажи»); сумма по этапам = число активных заявок.

/** Счётчики по столбцам таблицы. contact — клиентский показатель (см. ниже). */
export interface StageCounts {
  application: number
  trial_scheduled: number
  trial_attended: number
  awaiting_payment: number
  contact: number
}

export interface FunnelDirectionNode {
  directionId: string | null
  directionName: string
  /** contact на уровне направления всегда 0 — «Связь» ведётся по клиенту, не по направлению. */
  counts: StageCounts
}

export interface FunnelBranchNode {
  branchId: string | null
  branchName: string
  counts: StageCounts
  directions: FunnelDirectionNode[]
}

export interface LiveFunnel {
  branches: FunnelBranchNode[]
  totals: StageCounts
}

function emptyCounts(): StageCounts {
  return { application: 0, trial_scheduled: 0, trial_attended: 0, awaiting_payment: 0, contact: 0 }
}

// Клиент не в архиве/ЧС + сегментный scope по филиалам (как в разделе «Продажи»,
// notArchivedClient в crm/sales/page.tsx).
function notArchivedClient(scope: BranchScope): Prisma.ClientWhereInput {
  const base: Prisma.ClientWhereInput = {
    deletedAt: null,
    funnelStatus: { notIn: ["archived", "blacklisted"] },
  }
  const seg = scopeClientByBranch(scope)
  return Object.keys(seg).length > 0 ? { AND: [base, seg] } : base
}

const NO_BRANCH = "__no_branch__"
const NO_DIR = "__no_direction__"

/**
 * Считает снимок воронки «на сейчас» с учётом видимости по филиалам (ADM-04).
 * Столбцы-этапы — по активным заявкам; «Связь» на уровне филиала разносится по
 * активной заявке клиента, в «Всего» — все клиенты с назначенной датой связи
 * (совпадает со вкладкой Продажи → Связь при «Все филиалы»).
 */
export async function computeLiveFunnel(tenantId: string, scope: BranchScope): Promise<LiveFunnel> {
  const appWhere: Prisma.ApplicationWhereInput = {
    tenantId,
    status: "active",
    deletedAt: null,
    client: notArchivedClient(scope),
    // ADM-04: без явного фильтра заявки ограничены филиалами scope (branchId у заявки обязателен).
    ...scopeApplication(scope),
  }

  const [apps, branchList, directionList, totalContact] = await Promise.all([
    db.application.findMany({
      where: appWhere,
      select: {
        branchId: true,
        directionId: true,
        stage: true,
        clientId: true,
        client: { select: { nextContactDate: true } },
      },
    }),
    db.branch.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    db.direction.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    // «Всего» по «Связи» = клиенты с назначенной датой связи (как вкладка
    // Продажи → Связь при «Все филиалы»): по клиенту, без привязки к заявке.
    db.client.count({
      where: { tenantId, AND: [notArchivedClient(scope), { nextContactDate: { not: null } }] },
    }),
  ])

  const branchName = new Map(branchList.map((b) => [b.id, b.name]))
  const directionName = new Map(directionList.map((d) => [d.id, d.name]))

  const branches = new Map<
    string,
    {
      branchId: string | null
      branchName: string
      counts: StageCounts
      contactClients: Set<string>
      dirs: Map<string, FunnelDirectionNode>
    }
  >()

  for (const a of apps) {
    const bKey = a.branchId ?? NO_BRANCH
    let b = branches.get(bKey)
    if (!b) {
      b = {
        branchId: a.branchId,
        branchName: a.branchId ? branchName.get(a.branchId) ?? "—" : "Без филиала",
        counts: emptyCounts(),
        contactClients: new Set(),
        dirs: new Map(),
      }
      branches.set(bKey, b)
    }
    const dKey = a.directionId ?? NO_DIR
    let d = b.dirs.get(dKey)
    if (!d) {
      d = {
        directionId: a.directionId,
        directionName: a.directionId ? directionName.get(a.directionId) ?? "—" : "Без направления",
        counts: emptyCounts(),
      }
      b.dirs.set(dKey, d)
    }

    const st = a.stage
    if (
      st === "application" ||
      st === "trial_scheduled" ||
      st === "trial_attended" ||
      st === "awaiting_payment"
    ) {
      b.counts[st]++
      d.counts[st]++
    }
    // «Связь» на уровне филиала — уникальные клиенты с назначенной датой связи.
    if (a.client.nextContactDate) b.contactClients.add(a.clientId)
  }

  const totals = emptyCounts()
  const branchNodes: FunnelBranchNode[] = [...branches.values()]
    .map((b) => {
      b.counts.contact = b.contactClients.size
      for (const k of ["application", "trial_scheduled", "trial_attended", "awaiting_payment"] as const) {
        totals[k] += b.counts[k]
      }
      const directions = [...b.dirs.values()].sort((x, y) =>
        x.directionName.localeCompare(y.directionName, "ru"),
      )
      return { branchId: b.branchId, branchName: b.branchName, counts: b.counts, directions }
    })
    .sort((x, y) => x.branchName.localeCompare(y.branchName, "ru"))

  totals.contact = totalContact

  return { branches: branchNodes, totals }
}
