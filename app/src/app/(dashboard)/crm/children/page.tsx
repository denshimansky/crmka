import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { PageHelp } from "@/components/page-help"
import { ChildrenTable, type ChildRow, type BranchOption } from "./children-table"
import { maskPhone, getVisibilitySettings } from "@/lib/permissions/phone-visibility"

export default async function ChildrenPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  // Все подопечные тенанта вместе с родителем и его статусом в воронке/клиентской базе.
  // «Активный» считаем на уровне РЕБЁНКА (а не родителя): есть свой активный
  // абонемент ИЛИ числится в активной группе через активный Enrollment.
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
        },
      },
    },
    orderBy: [{ client: { lastName: "asc" } }, { client: { firstName: "asc" } }, { firstName: "asc" }],
  })

  // Per-ward признак «есть активный абонемент на ребёнка» (статус active/pending,
  // не отчислён). Используется для состояния «Активный».
  const wardIds = wards.map((w) => w.id)
  const activeSubsByWard = wardIds.length
    ? await db.subscription.groupBy({
        by: ["wardId"],
        where: {
          tenantId,
          wardId: { in: wardIds },
          deletedAt: null,
          withdrawalDate: null,
          status: { in: ["active", "pending"] },
        },
        _count: { _all: true },
      })
    : []
  const hasActiveSubSet = new Set(
    activeSubsByWard.filter((r) => r.wardId).map((r) => r.wardId as string),
  )

  // Per-ward признак «активный enrollment в активной группе» + филиал последнего
  // прошедшего занятия (как было раньше).
  const enrollments = await db.groupEnrollment.findMany({
    where: { tenantId, wardId: { in: wardIds }, deletedAt: null },
    select: {
      wardId: true,
      groupId: true,
      isActive: true,
      group: {
        select: {
          id: true,
          isActive: true,
          branchId: true,
          branch: { select: { id: true, name: true } },
        },
      },
    },
  })

  // Признак «активный enrollment»: enrollment.isActive AND group.isActive (живая группа).
  const hasActiveEnrollmentSet = new Set<string>()
  for (const e of enrollments) {
    if (!e.wardId) continue
    if (e.isActive && e.group.isActive) hasActiveEnrollmentSet.add(e.wardId)
  }

  // Филиал посещения = филиал группы из последнего ПРОШЕДШЕГО Lesson этого ребёнка.
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

  // Состояние ребёнка (приоритет: архив/ЧС → активный (свой суб/enrollment) →
  // выбывший родитель → нецелевой → потенциал → лид).
  function stateOf(
    wardId: string,
    client: (typeof wards)[number]["client"],
  ): ChildRow["state"] {
    if (client.funnelStatus === "archived") return "archived"
    if (client.funnelStatus === "blacklisted") return "blacklist"
    if (hasActiveSubSet.has(wardId) || hasActiveEnrollmentSet.has(wardId)) return "active"
    if (client.clientStatus === "churned") return "churned"
    if (client.funnelStatus === "non_target") return "nontarget"
    if (client.funnelStatus === "potential") return "potential"
    return "lead"
  }

  const visibility = await getVisibilitySettings(tenantId)
  const role = session.user.role

  const rows: ChildRow[] = wards.map((w) => {
    const branch = wardBranch.get(w.id) ?? { branchId: null, branchName: null }
    return {
      id: w.id,
      firstName: w.firstName,
      lastName: w.lastName,
      birthDate: w.birthDate ? w.birthDate.toISOString() : null,
      parentId: w.client.id,
      parentName:
        [w.client.lastName, w.client.firstName, w.client.patronymic].filter(Boolean).join(" ") || "Без имени",
      parentPhone: maskPhone(w.client.phone, role, visibility.hidePhonesFromInstructors),
      parentComment: w.client.comment,
      branchId: branch.branchId,
      branchName: branch.branchName,
      state: stateOf(w.id, w.client),
    }
  })

  // Список филиалов для фильтра (все, по которым кто-то посещал занятия).
  const branchOptions: BranchOption[] = Array.from(
    new Map(
      rows
        .filter((r) => r.branchId && r.branchName)
        .map((r) => [r.branchId!, { id: r.branchId!, name: r.branchName! }]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name, "ru"))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Дети</h1>
        <PageHelp pageKey="crm/children" />
      </div>

      <ChildrenTable rows={rows} branches={branchOptions} />
    </div>
  )
}
