import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft, Users, CheckCircle2 } from "lucide-react"
import Link from "next/link"

export default async function CapacityReportPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  // Все активные группы с зачислениями
  const groups = await db.group.findMany({
    where: { tenantId, deletedAt: null, isActive: true },
    include: {
      direction: { select: { name: true } },
      branch: { select: { name: true } },
      room: { select: { name: true } },
      instructor: { select: { firstName: true, lastName: true } },
      enrollments: {
        where: { isActive: true, deletedAt: null },
        select: { id: true, clientId: true },
      },
    },
    orderBy: { name: "asc" },
  })

  // Клиенты со статусом trial_scheduled или awaiting_payment, зачисленные в группы
  const enrolledClientIds = [...new Set(groups.flatMap(g => g.enrollments.map(e => e.clientId)))]
  const clientStatuses = enrolledClientIds.length > 0
    ? await db.client.findMany({
        where: { id: { in: enrolledClientIds }, tenantId, deletedAt: null },
        select: { id: true, funnelStatus: true },
      })
    : []
  const clientStatusMap = new Map(clientStatuses.map(c => [c.id, c.funnelStatus]))

  const rows = groups.map((g) => {
    const enrolled = g.enrollments.length
    const capacity = g.maxStudents
    const onTrial = g.enrollments.filter(e => clientStatusMap.get(e.clientId) === "trial_scheduled").length
    const awaitingPayment = g.enrollments.filter(e => clientStatusMap.get(e.clientId) === "awaiting_payment").length
    const confirmed = enrolled - onTrial - awaitingPayment
    const free = Math.max(0, capacity - enrolled)
    const percent = capacity > 0 ? Math.round((enrolled / capacity) * 100) : 0
    const instructor = [g.instructor.lastName, g.instructor.firstName].filter(Boolean).join(" ")

    return {
      id: g.id,
      name: g.name,
      direction: g.direction.name,
      branch: g.branch.name,
      room: g.room.name,
      instructor,
      enrolled,
      confirmed,
      onTrial,
      awaitingPayment,
      capacity,
      free,
      percent,
    }
  })

  const totalEnrolled = rows.reduce((s, r) => s + r.enrolled, 0)
  const totalCapacity = rows.reduce((s, r) => s + r.capacity, 0)
  const totalFree = rows.reduce((s, r) => s + r.free, 0)
  const totalOnTrial = rows.reduce((s, r) => s + r.onTrial, 0)
  const totalAwaitingPayment = rows.reduce((s, r) => s + r.awaitingPayment, 0)
  const avgPercent = totalCapacity > 0 ? Math.round((totalEnrolled / totalCapacity) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Свободные места</h1>
          <p className="text-sm text-muted-foreground">Загруженность групп</p>
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
            <p className="text-2xl font-bold text-blue-600">{totalEnrolled}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Свободно</p>
            <p className="text-2xl font-bold text-green-600">{totalFree}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Загрузка</p>
            <p className="text-2xl font-bold">{avgPercent}%</p>
          </CardContent>
        </Card>
      </div>

      {rows.length === 0 ? (
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
                <TableHead>Группа</TableHead>
                <TableHead>Направление</TableHead>
                <TableHead>Филиал</TableHead>
                <TableHead>Инструктор</TableHead>
                <TableHead className="text-center">Занято</TableHead>
                <TableHead className="text-center">Пробные</TableHead>
                <TableHead className="text-center">Ждут оплату</TableHead>
                <TableHead className="text-center">Макс</TableHead>
                <TableHead className="text-center">Свободно</TableHead>
                <TableHead className="text-right">Загрузка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/schedule/groups/${r.id}`} className="font-medium text-primary hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell>{r.direction}</TableCell>
                  <TableCell className="text-muted-foreground">{r.branch}</TableCell>
                  <TableCell className="text-muted-foreground">{r.instructor}</TableCell>
                  <TableCell className="text-center font-medium">{r.enrolled}</TableCell>
                  <TableCell className="text-center text-cyan-600">{r.onTrial || "—"}</TableCell>
                  <TableCell className="text-center text-yellow-600">{r.awaitingPayment || "—"}</TableCell>
                  <TableCell className="text-center text-muted-foreground">{r.capacity}</TableCell>
                  <TableCell className="text-center">
                    <span className={r.free > 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                      {r.free}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={r.percent >= 90 ? "destructive" : r.percent >= 70 ? "default" : "outline"}>
                      {r.percent}%
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-bold">
                <TableCell colSpan={4}>Итого</TableCell>
                <TableCell className="text-center">{totalEnrolled}</TableCell>
                <TableCell className="text-center text-cyan-600">{totalOnTrial || "—"}</TableCell>
                <TableCell className="text-center text-yellow-600">{totalAwaitingPayment || "—"}</TableCell>
                <TableCell className="text-center">{totalCapacity}</TableCell>
                <TableCell className="text-center text-green-600">{totalFree}</TableCell>
                <TableCell className="text-right">{avgPercent}%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
