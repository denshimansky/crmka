import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { PageHelp } from "@/components/page-help"
import { ChildrenTable, type ChildRow } from "./children-table"

export default async function ChildrenPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  // Все подопечные тенанта вместе с родителем и его статусом в воронке/клиентской базе.
  // Активный абонемент родителя считаем для отображения состояния «Активный»
  // (та же логика, что в contacts-table.tsx → stateLabel).
  const wards = await db.ward.findMany({
    where: { tenantId, client: { deletedAt: null } },
    include: {
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          patronymic: true,
          phone: true,
          comment: true,
          funnelStatus: true,
          clientStatus: true,
          subscriptions: {
            where: { status: "active", deletedAt: null },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ client: { lastName: "asc" } }, { client: { firstName: "asc" } }, { firstName: "asc" }],
  })

  // Филиал посещения = филиал группы из последнего ПРОШЕДШЕГО Lesson этого ребёнка.
  // Шаг 1: подтягиваем все enrollments детей с groupId и branch-инфой.
  const enrollments = await db.groupEnrollment.findMany({
    where: { tenantId, wardId: { in: wards.map((w) => w.id) }, deletedAt: null },
    select: {
      wardId: true,
      groupId: true,
      group: { select: { id: true, branchId: true, branch: { select: { id: true, name: true } } } },
    },
  })

  // Шаг 2: для каждой группы — последняя прошедшая дата занятия.
  const today = new Date()
  today.setHours(23, 59, 59, 999)
  const groupIds = Array.from(new Set(enrollments.map((e) => e.groupId)))
  const lessonAgg = groupIds.length
    ? await db.lesson.groupBy({
        by: ["groupId"],
        where: { tenantId, date: { lte: today }, groupId: { in: groupIds } },
        _max: { date: true },
      })
    : []
  const groupMaxDate = new Map<string, Date | null>(
    lessonAgg.map((l) => [l.groupId, l._max.date ?? null]),
  )

  // Шаг 3: для каждого ребёнка — выбираем enrollment с максимальной датой и берём филиал группы.
  const wardBranch = new Map<string, { branchId: string | null; branchName: string | null }>()
  for (const w of wards) {
    const enrs = enrollments.filter((e) => e.wardId === w.id)
    let bestDate: Date | null = null
    let bestBranchId: string | null = null
    let bestBranchName: string | null = null
    for (const e of enrs) {
      const d = groupMaxDate.get(e.groupId) ?? null
      if (d && (!bestDate || d.getTime() > bestDate.getTime())) {
        bestDate = d
        bestBranchId = e.group.branchId
        bestBranchName = e.group.branch?.name ?? null
      }
    }
    wardBranch.set(w.id, { branchId: bestBranchId, branchName: bestBranchName })
  }

  // Состояние родителя (приоритет: архив/ЧС → активный (есть абонемент) → выбывший → нецелевой → потенциал → лид).
  // Логика та же, что в contacts-table.tsx → stateLabel.
  function stateOf(client: (typeof wards)[number]["client"]): ChildRow["state"] {
    if (client.funnelStatus === "archived") return "archived"
    if (client.funnelStatus === "blacklisted") return "blacklist"
    if (client.subscriptions.length > 0) return "active"
    if (client.clientStatus === "churned") return "churned"
    if (client.funnelStatus === "non_target") return "nontarget"
    if (client.funnelStatus === "potential") return "potential"
    return "lead"
  }

  const rows: ChildRow[] = wards.map((w) => ({
    id: w.id,
    firstName: w.firstName,
    lastName: w.lastName,
    birthDate: w.birthDate ? w.birthDate.toISOString() : null,
    parentId: w.client.id,
    parentName: [w.client.lastName, w.client.firstName, w.client.patronymic].filter(Boolean).join(" ") || "Без имени",
    parentPhone: w.client.phone,
    parentComment: w.client.comment,
    branchName: wardBranch.get(w.id)?.branchName ?? null,
    state: stateOf(w.client),
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Дети</h1>
        <PageHelp pageKey="crm/children" />
      </div>

      <ChildrenTable rows={rows} />
    </div>
  )
}
