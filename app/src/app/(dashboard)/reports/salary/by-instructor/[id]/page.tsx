import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount)) + " ₽"
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

// Причина 0 ₽ на конкретном занятии — для UI «почему не начислили».
// Возвращает короткую человекочитаемую строку или null, если ЗП > 0.
function whyZero(args: {
  salary: number
  hasPayingAttendances: boolean
  isTrial: boolean
  payForTrialLessons: boolean
  rateConfigured: boolean
}): string | null {
  if (args.salary > 0) return null
  if (args.isTrial && !args.payForTrialLessons) {
    return "пробное — организация не платит за пробные"
  }
  if (!args.rateConfigured) {
    return "ставка не настроена"
  }
  if (!args.hasPayingAttendances) {
    return "нет оплачиваемых отметок"
  }
  return "флаг «оплачивать» снят на отметках"
}

export default async function SalaryByInstructorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const { id: instructorId } = await params

  const { year, month } = getMonthFromParams(await searchParams)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))

  const instructor = await db.employee.findFirst({
    where: { id: instructorId, tenantId },
    select: { id: true, firstName: true, lastName: true, role: true },
  })
  if (!instructor) notFound()

  // Все занятия за месяц, где этот сотрудник — основной педагог ИЛИ заменяющий.
  // ЗП считается заменяющему, если он указан, иначе основному (resolveRate ниже).
  const lessons = await db.lesson.findMany({
    where: {
      tenantId,
      date: { gte: monthStart, lte: monthEnd },
      OR: [{ instructorId }, { substituteInstructorId: instructorId }],
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      isTrial: true,
      instructorId: true,
      substituteInstructorId: true,
      group: {
        select: {
          id: true,
          name: true,
          directionId: true,
          direction: { select: { name: true } },
        },
      },
      attendances: {
        select: {
          id: true,
          instructorPayAmount: true,
          instructorPayEnabled: true,
          isTrial: true,
          attendanceType: { select: { code: true, name: true, paysInstructor: true } },
        },
      },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  })

  // Только занятия, где этот сотрудник — эффективный педагог (с учётом замены).
  const effectiveLessons = lessons.filter((l) => {
    const eff = l.substituteInstructorId || l.instructorId
    return eff === instructorId
  })

  // Ставки сотрудника по направлениям — нужны и для отображения, и для отметки
  // «ставка не настроена» в причинах 0 ₽.
  const rates = await db.salaryRate.findMany({
    where: { tenantId, employeeId: instructorId },
    select: { directionId: true, scheme: true, ratePerStudent: true, ratePerLesson: true },
  })
  const rateByDirection = new Map(rates.filter((r) => r.directionId).map((r) => [r.directionId!, r]))
  const defaultRate = rates.find((r) => !r.directionId) ?? null

  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { payForTrialLessons: true },
  })
  const payForTrials = !!org?.payForTrialLessons

  // Сводка
  const totalLessons = effectiveLessons.length
  const totalTrials = effectiveLessons.filter((l) => l.isTrial).length
  let totalStudents = 0
  let totalSalary = 0

  type Row = {
    id: string
    date: Date
    startTime: string
    isTrial: boolean
    isSubstitute: boolean
    groupName: string
    directionName: string
    studentsCount: number
    salary: number
    reason: string | null
    rateLabel: string
  }

  const rows: Row[] = effectiveLessons.map((l) => {
    const paying = l.attendances.filter((a) => a.attendanceType.paysInstructor)
    const studentsCount = paying.length
    totalStudents += studentsCount

    const salary = l.attendances.reduce(
      (s, a) => (a.instructorPayEnabled ? s + Number(a.instructorPayAmount) : s),
      0,
    )
    totalSalary += salary

    const lessonIsTrial = l.isTrial || l.attendances.some((a) => a.isTrial)
    const rate = rateByDirection.get(l.group.directionId) ?? defaultRate
    const rateConfigured = !!rate
    const hasPayingAttendances = l.attendances.some(
      (a) => a.attendanceType.paysInstructor && Number(a.instructorPayAmount) > 0,
    )

    const rateLabel = rate
      ? rate.scheme === "per_student" && rate.ratePerStudent
        ? `${formatMoney(Number(rate.ratePerStudent))} / ученик`
        : rate.scheme === "per_lesson" && rate.ratePerLesson
          ? `${formatMoney(Number(rate.ratePerLesson))} / занятие`
          : rate.scheme
      : "—"

    return {
      id: l.id,
      date: l.date,
      startTime: l.startTime,
      isTrial: lessonIsTrial,
      isSubstitute: l.substituteInstructorId === instructorId && l.instructorId !== instructorId,
      groupName: l.group.name,
      directionName: l.group.direction.name,
      studentsCount,
      salary,
      reason: whyZero({
        salary,
        hasPayingAttendances,
        isTrial: lessonIsTrial,
        payForTrialLessons: payForTrials,
        rateConfigured,
      }),
      rateLabel,
    }
  })

  const instructorName =
    [instructor.lastName, instructor.firstName].filter(Boolean).join(" ") || "Без имени"
  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/reports/salary/by-instructor?year=${year}&month=${month}`}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{instructorName}</h1>
            <PageHelp pageKey="reports/salary/by-instructor" />
          </div>
          <p className="text-sm text-muted-foreground">
            Занятия и начисленная ЗП за период
          </p>
        </div>
        <MonthPicker />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Период:</span>
        <Badge variant="outline">{monthName}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Занятий проведено</p>
            <p className="text-2xl font-bold text-blue-600">{totalLessons}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">из них пробных</p>
            <p className="text-2xl font-bold">{totalTrials}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Посещений (оплачиваемые типы)</p>
            <p className="text-2xl font-bold">{totalStudents}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">ЗП начислено</p>
            <p className="text-2xl font-bold text-green-600">{formatMoney(totalSalary)}</p>
          </CardContent>
        </Card>
      </div>

      {totalTrials > 0 && !payForTrials && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4 text-sm">
            В этом месяце {totalTrials} {totalTrials === 1 ? "пробное" : "пробных"} —
            за них ЗП не начисляется по настройке организации
            («Настройки → Организация → Платить педагогу за пробные»).
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            В этом месяце нет занятий
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Группа / направление</TableHead>
                <TableHead>Ставка</TableHead>
                <TableHead className="text-right">Учеников</TableHead>
                <TableHead className="text-right">Начислено ЗП</TableHead>
                <TableHead>Комментарий</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="hover:bg-muted/50">
                  <TableCell className="whitespace-nowrap">
                    <Link
                      href={`/schedule/lessons/${r.id}`}
                      className="font-medium hover:underline"
                    >
                      {formatDate(r.date)}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.startTime}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{r.groupName}</div>
                    <div className="text-xs text-muted-foreground">{r.directionName}</div>
                    <div className="mt-1 flex gap-1">
                      {r.isTrial && (
                        <Badge variant="outline" className="text-xs">пробное</Badge>
                      )}
                      {r.isSubstitute && (
                        <Badge variant="secondary" className="text-xs">замена</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.rateLabel}</TableCell>
                  <TableCell className="text-right">{r.studentsCount}</TableCell>
                  <TableCell className="text-right font-medium">{formatMoney(r.salary)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-bold">
                <TableCell colSpan={3}>Итого</TableCell>
                <TableCell className="text-right">{totalStudents}</TableCell>
                <TableCell className="text-right">{formatMoney(totalSalary)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
