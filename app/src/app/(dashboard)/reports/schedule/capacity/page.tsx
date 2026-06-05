import { PageHelp } from "@/components/page-help"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

interface GroupRow {
  id: string
  name: string
  direction: string
  enrolled: number
  onTrial: number
  capacity: number
  free: number
  percent: number
}

interface AggRow {
  capacity: number
  enrolled: number
  onTrial: number
  free: number
  percent: number
}

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
        select: { id: true, wardId: true },
      },
    },
    orderBy: [{ branch: { name: "asc" } }, { room: { name: "asc" } }, { name: "asc" }],
  })

  const enrolledWardIds = [...new Set(
    groups.flatMap(g => g.enrollments.map(e => e.wardId).filter((id): id is string => Boolean(id)))
  )]
  const wardStages = enrolledWardIds.length > 0
    ? await db.ward.findMany({
        where: { id: { in: enrolledWardIds }, tenantId },
        select: { id: true, salesStage: true },
      })
    : []
  const wardStageMap = new Map(wardStages.map(w => [w.id, w.salesStage]))

  // Иерархия branch → room → groups
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
    const onTrial = g.enrollments.filter(
      (e) => e.wardId && wardStageMap.get(e.wardId) === "trial_scheduled"
    ).length
    const capacity = g.maxStudents
    const free = Math.max(0, capacity - enrolled)
    const percent = pct(enrolled, capacity)

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
    b.agg.percent = pct(b.agg.enrolled, b.agg.capacity)
    for (const r of b.rooms.values()) {
      r.agg.percent = pct(r.agg.enrolled, r.agg.capacity)
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
  total.percent = pct(total.enrolled, total.capacity)

  const branchList = [...branches.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"))

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

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Групп</p>
            <p className="text-2xl font-bold">{groups.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Занято мест</p>
            <p className="text-2xl font-bold text-blue-600">{total.enrolled}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Свободно</p>
            <p className="text-2xl font-bold text-green-600">{total.free}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Загрузка</p>
            <p className="text-2xl font-bold">{total.percent}%</p>
          </CardContent>
        </Card>
      </div>

      {branchList.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет активных групп
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Филиал / Кабинет / Группа</TableHead>
                <TableHead>Направление</TableHead>
                <TableHead className="text-center">Всего мест</TableHead>
                <TableHead className="text-center">Занято</TableHead>
                <TableHead className="text-center">Записано на пробники</TableHead>
                <TableHead className="text-center">Свободно</TableHead>
                <TableHead className="text-right">% заполнения</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-emerald-50/70 font-bold dark:bg-emerald-950/30">
                <TableCell colSpan={2}>Итого</TableCell>
                <TableCell className="text-center">{total.capacity}</TableCell>
                <TableCell className="text-center text-blue-700">{total.enrolled}</TableCell>
                <TableCell className="text-center text-cyan-700">
                  {total.onTrial || ""}
                </TableCell>
                <TableCell className="text-center text-green-700">{total.free}</TableCell>
                <TableCell className="text-right">{total.percent}%</TableCell>
              </TableRow>

              {branchList.map((branch) => {
                const roomList = [...branch.rooms.values()].sort((a, b) =>
                  a.name.localeCompare(b.name, "ru"),
                )
                return (
                  <FragmentNode key={branch.id}>
                    <TableRow className="bg-emerald-50/40 font-semibold dark:bg-emerald-950/15">
                      <TableCell colSpan={2}>{branch.name}</TableCell>
                      <TableCell className="text-center">{branch.agg.capacity}</TableCell>
                      <TableCell className="text-center text-blue-700">{branch.agg.enrolled}</TableCell>
                      <TableCell className="text-center text-cyan-700">
                        {branch.agg.onTrial || ""}
                      </TableCell>
                      <TableCell className="text-center text-green-700">{branch.agg.free}</TableCell>
                      <TableCell className="text-right">{branch.agg.percent}%</TableCell>
                    </TableRow>

                    {roomList.map((room) => (
                      <FragmentNode key={room.id}>
                        <TableRow className="bg-emerald-50/20 font-medium dark:bg-emerald-950/10">
                          <TableCell colSpan={2} className="pl-8 text-emerald-900 dark:text-emerald-200">
                            {room.name}
                          </TableCell>
                          <TableCell className="text-center">{room.agg.capacity}</TableCell>
                          <TableCell className="text-center">{room.agg.enrolled}</TableCell>
                          <TableCell className="text-center text-cyan-700">
                            {room.agg.onTrial || ""}
                          </TableCell>
                          <TableCell className="text-center text-green-700">{room.agg.free}</TableCell>
                          <TableCell className="text-right">{room.agg.percent}%</TableCell>
                        </TableRow>

                        {room.groups.map((g) => (
                          <TableRow key={g.id}>
                            <TableCell className="pl-16">
                              <Link
                                href={`/schedule/groups/${g.id}`}
                                className="text-primary hover:underline"
                              >
                                {g.name}
                              </Link>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{g.direction}</TableCell>
                            <TableCell className="text-center text-muted-foreground">
                              {g.capacity}
                            </TableCell>
                            <TableCell className="text-center">{g.enrolled || ""}</TableCell>
                            <TableCell className="text-center text-cyan-600">
                              {g.onTrial || ""}
                            </TableCell>
                            <TableCell className="text-center">
                              <span className={g.free > 0 ? "text-green-600" : "text-red-600 font-medium"}>
                                {g.free}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              {g.enrolled > 0 ? (
                                <Badge
                                  variant={
                                    g.percent >= 90
                                      ? "destructive"
                                      : g.percent >= 70
                                        ? "default"
                                        : "outline"
                                  }
                                >
                                  {g.percent}%
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </FragmentNode>
                    ))}
                  </FragmentNode>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

// Лёгкий обёрточный фрагмент, чтобы TypeScript принял группировку строк
// в TableBody без лишних DOM-нод.
function FragmentNode({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
