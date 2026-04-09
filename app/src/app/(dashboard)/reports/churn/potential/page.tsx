import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { ArrowLeft, AlertTriangle } from "lucide-react"
import Link from "next/link"

function formatDate(date: Date | null): string {
  if (!date) return "—"
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export default async function PotentialChurnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const sp = await searchParams

  const { year, month } = getMonthFromParams(sp)
  const thresholdParam = typeof sp.threshold === "string" ? parseInt(sp.threshold, 10) : 3
  const threshold = Math.max(1, isNaN(thresholdParam) ? 3 : thresholdParam)
  const branchId = typeof sp.branchId === "string" ? sp.branchId : undefined

  const dateFrom = new Date(Date.UTC(year, month - 1, 1))
  const dateTo = new Date(Date.UTC(year, month, 0, 23, 59, 59))

  // Branches for display
  const branches = await db.branch.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  // Find active enrollments
  const enrollmentWhere: any = {
    tenantId,
    isActive: true,
    deletedAt: null,
  }
  if (branchId) {
    enrollmentWhere.group = { branchId }
  }

  const enrollments = await db.groupEnrollment.findMany({
    where: enrollmentWhere,
    select: {
      id: true,
      clientId: true,
      wardId: true,
      group: {
        select: {
          id: true,
          name: true,
          direction: { select: { name: true } },
          branch: { select: { id: true, name: true } },
        },
      },
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      ward: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  })

  // Absence types (no charge, no instructor pay)
  const absenceTypes = await db.attendanceType.findMany({
    where: {
      OR: [{ tenantId }, { tenantId: null }],
      chargesSubscription: false,
      paysInstructor: false,
    },
    select: { id: true },
  })
  const absenceTypeIds = absenceTypes.map((t) => t.id)

  // Get absences for the month
  const absences = absenceTypeIds.length > 0
    ? await db.attendance.findMany({
        where: {
          tenantId,
          attendanceTypeId: { in: absenceTypeIds },
          lesson: { date: { gte: dateFrom, lte: dateTo } },
        },
        select: {
          clientId: true,
          wardId: true,
          lesson: { select: { date: true, groupId: true } },
        },
        orderBy: { lesson: { date: "desc" } },
      })
    : []

  // Group absences by clientId+wardId+groupId
  const absenceMap = new Map<string, { count: number; lastDate: Date }>()
  for (const a of absences) {
    const key = `${a.clientId}|${a.wardId || ""}|${a.lesson.groupId}`
    const existing = absenceMap.get(key)
    if (existing) {
      existing.count++
      if (a.lesson.date > existing.lastDate) existing.lastDate = a.lesson.date
    } else {
      absenceMap.set(key, { count: 1, lastDate: a.lesson.date })
    }
  }

  // Build rows
  const rows: Array<{
    clientId: string
    clientName: string
    wardName: string | null
    groupName: string
    directionName: string
    branchName: string
    absenceCount: number
    lastAbsenceDate: Date
  }> = []

  for (const enrollment of enrollments) {
    const key = `${enrollment.clientId}|${enrollment.wardId || ""}|${enrollment.group.id}`
    const info = absenceMap.get(key)
    if (info && info.count >= threshold) {
      rows.push({
        clientId: enrollment.clientId,
        clientName: [enrollment.client.lastName, enrollment.client.firstName].filter(Boolean).join(" ") || "Без имени",
        wardName: enrollment.ward
          ? [enrollment.ward.lastName, enrollment.ward.firstName].filter(Boolean).join(" ") || null
          : null,
        groupName: enrollment.group.name,
        directionName: enrollment.group.direction.name,
        branchName: enrollment.group.branch.name,
        absenceCount: info.count,
        lastAbsenceDate: info.lastDate,
      })
    }
  }

  rows.sort((a, b) => b.absenceCount - a.absenceCount)

  const selectedBranchName = branchId
    ? branches.find((b) => b.id === branchId)?.name || "—"
    : "Все"

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Потенциальный отток</h1>
            <PageHelp pageKey="reports/churn/potential" />
          </div>
          <p className="text-sm text-muted-foreground">
            Ученики с {threshold}+ прогулами за месяц
          </p>
        </div>
        <MonthPicker />
      </div>

      {/* Filters summary */}
      <div className="flex flex-wrap gap-3">
        <Card className="min-w-[140px]">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-red-600">{rows.length}</p>
            <p className="text-xs text-muted-foreground">Учеников в зоне риска</p>
          </CardContent>
        </Card>
        <Card className="min-w-[140px]">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{threshold}+</p>
            <p className="text-xs text-muted-foreground">Порог прогулов</p>
          </CardContent>
        </Card>
        <Card className="min-w-[140px]">
          <CardContent className="p-3 text-center">
            <p className="text-lg font-bold">{selectedBranchName}</p>
            <p className="text-xs text-muted-foreground">Филиал</p>
          </CardContent>
        </Card>
      </div>

      {/* Branch filter links */}
      {branches.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Link href={`/reports/churn/potential?threshold=${threshold}`}>
            <Badge variant={!branchId ? "default" : "outline"}>Все филиалы</Badge>
          </Link>
          {branches.map((b) => (
            <Link key={b.id} href={`/reports/churn/potential?branchId=${b.id}&threshold=${threshold}`}>
              <Badge variant={branchId === b.id ? "default" : "outline"}>{b.name}</Badge>
            </Link>
          ))}
        </div>
      )}

      {/* Table */}
      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
            <AlertTriangle className="size-10 text-muted-foreground/50" />
            <p>Нет учеников с {threshold}+ прогулами за этот месяц</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Клиент</TableHead>
                <TableHead>Подопечный</TableHead>
                <TableHead>Группа</TableHead>
                <TableHead>Направление</TableHead>
                <TableHead className="text-center">Прогулов</TableHead>
                <TableHead>Последний прогул</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={`${r.clientId}-${r.groupName}-${i}`}>
                  <TableCell>
                    <Link href={`/crm/clients/${r.clientId}`} className="font-medium text-primary hover:underline">
                      {r.clientName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.wardName || "—"}</TableCell>
                  <TableCell>{r.groupName}</TableCell>
                  <TableCell className="text-muted-foreground">{r.directionName}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={r.absenceCount >= 5 ? "destructive" : "secondary"}>
                      {r.absenceCount}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(r.lastAbsenceDate)}</TableCell>
                  <TableCell>
                    <Link href={`/crm/clients/${r.clientId}`}>
                      <Button variant="outline" size="sm">Карточка</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
