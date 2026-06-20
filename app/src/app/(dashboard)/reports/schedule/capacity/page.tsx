import { PageHelp } from "@/components/page-help"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { CapacityTable, type CapacityData, type AggRow, type GroupRow } from "./capacity-table"

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

export default async function CapacityReportPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const groups = await db.group.findMany({
    where: { tenantId, deletedAt: null, isActive: true, isOneTime: false },
    include: {
      direction: { select: { name: true } },
      branch: { select: { id: true, name: true } },
      room: { select: { id: true, name: true } },
      enrollments: {
        where: { isActive: true, deletedAt: null },
        select: { id: true, wardId: true, clientId: true },
      },
    },
    orderBy: [{ branch: { name: "asc" } }, { room: { name: "asc" } }, { name: "asc" }],
  })

  // «Записано на пробники» считаем по запланированным пробным (TrialLesson,
  // status=scheduled, привязанным к группе): они «висят» отдельными записями и
  // НЕ создают GroupEnrollment, поэтому через этап воронки записанных учеников
  // не подтягивались — отчёт показывал 0 (баг #36). Ключ занятости — ребёнок
  // (ward) или взрослый клиент; уже зачисленных в эту же группу не дублируем.
  const occupantKey = (wardId: string | null, clientId: string | null): string | null =>
    wardId ?? (clientId ? `c:${clientId}` : null)

  const scheduledTrials = await db.trialLesson.findMany({
    where: { tenantId, status: "scheduled", groupId: { not: null } },
    select: { groupId: true, wardId: true, clientId: true },
  })
  const trialKeysByGroup = new Map<string, Set<string>>()
  for (const t of scheduledTrials) {
    if (!t.groupId) continue
    const key = occupantKey(t.wardId, t.clientId)
    if (!key) continue
    let set = trialKeysByGroup.get(t.groupId)
    if (!set) {
      set = new Set()
      trialKeysByGroup.set(t.groupId, set)
    }
    set.add(key)
  }

  interface RoomBucket {
    id: string
    name: string
    groups: GroupRow[]
    agg: AggRow
  }
  interface BranchBucket {
    id: string
    name: string
    rooms: Map<string, RoomBucket>
    agg: AggRow
  }

  const branches = new Map<string, BranchBucket>()

  for (const g of groups) {
    const enrolled = g.enrollments.length
    const enrolledKeys = new Set(
      g.enrollments
        .map((e) => occupantKey(e.wardId, e.clientId))
        .filter((k): k is string => Boolean(k))
    )
    const trialKeys = trialKeysByGroup.get(g.id)
    const onTrial = trialKeys ? [...trialKeys].filter((k) => !enrolledKeys.has(k)).length : 0
    const capacity = g.maxStudents
    const occupied = enrolled + onTrial
    const free = Math.max(0, capacity - occupied)
    const percent = pct(occupied, capacity)

    const row: GroupRow = {
      id: g.id,
      name: g.name,
      direction: g.direction.name,
      enrolled,
      onTrial,
      capacity,
      free,
      percent,
    }

    let branch = branches.get(g.branch.id)
    if (!branch) {
      branch = {
        id: g.branch.id,
        name: g.branch.name,
        rooms: new Map(),
        agg: { capacity: 0, enrolled: 0, onTrial: 0, free: 0, percent: 0 },
      }
      branches.set(g.branch.id, branch)
    }

    let room = branch.rooms.get(g.room.id)
    if (!room) {
      room = {
        id: g.room.id,
        name: g.room.name,
        groups: [],
        agg: { capacity: 0, enrolled: 0, onTrial: 0, free: 0, percent: 0 },
      }
      branch.rooms.set(g.room.id, room)
    }

    room.groups.push(row)
    room.agg.capacity += capacity
    room.agg.enrolled += enrolled
    room.agg.onTrial += onTrial
    room.agg.free += free

    branch.agg.capacity += capacity
    branch.agg.enrolled += enrolled
    branch.agg.onTrial += onTrial
    branch.agg.free += free
  }

  for (const b of branches.values()) {
    b.agg.percent = pct(b.agg.enrolled + b.agg.onTrial, b.agg.capacity)
    for (const r of b.rooms.values()) {
      r.agg.percent = pct(r.agg.enrolled + r.agg.onTrial, r.agg.capacity)
    }
  }

  const total: AggRow = {
    capacity: 0,
    enrolled: 0,
    onTrial: 0,
    free: 0,
    percent: 0,
  }
  for (const b of branches.values()) {
    total.capacity += b.agg.capacity
    total.enrolled += b.agg.enrolled
    total.onTrial += b.agg.onTrial
    total.free += b.agg.free
  }
  total.percent = pct(total.enrolled + total.onTrial, total.capacity)

  const data: CapacityData = {
    total,
    branches: [...branches.values()]
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((b) => ({
        id: b.id,
        name: b.name,
        agg: b.agg,
        rooms: [...b.rooms.values()]
          .sort((a, b) => a.name.localeCompare(b.name, "ru"))
          .map((r) => ({
            id: r.id,
            name: r.name,
            agg: r.agg,
            groups: r.groups,
          })),
      })),
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Свободные места</h1>
            <PageHelp pageKey="reports/schedule/capacity" />
          </div>
          <p className="text-sm text-muted-foreground">
            Загруженность по филиалам, кабинетам и группам
          </p>
        </div>
      </div>

      {data.branches.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет активных групп
          </CardContent>
        </Card>
      ) : (
        <CapacityTable data={data} />
      )}
    </div>
  )
}
