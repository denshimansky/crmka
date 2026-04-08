import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount)) + " ₽"
}

export default async function SalaryByInstructorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const { year, month } = getMonthFromParams(await searchParams)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))

  // Все посещения за месяц с данными инструктора
  const attendances = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: monthStart, lte: monthEnd } },
    },
    select: {
      instructorPayAmount: true,
      instructorPayEnabled: true,
      lesson: {
        select: {
          id: true,
          instructorId: true,
          instructor: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      },
    },
  })

  // Группировка по инструктору
  const byInstructor = new Map<
    string,
    {
      name: string
      lessonsSet: Set<string>
      studentsCount: number
      salaryAccrued: number
    }
  >()

  for (const a of attendances) {
    const instrId = a.lesson.instructorId
    const prev = byInstructor.get(instrId) || {
      name: [a.lesson.instructor.lastName, a.lesson.instructor.firstName].filter(Boolean).join(" ") || "Без имени",
      lessonsSet: new Set<string>(),
      studentsCount: 0,
      salaryAccrued: 0,
    }
    prev.lessonsSet.add(a.lesson.id)
    prev.studentsCount += 1
    if (a.instructorPayEnabled) {
      prev.salaryAccrued += Number(a.instructorPayAmount)
    }
    byInstructor.set(instrId, prev)
  }

  const instructorRows = Array.from(byInstructor.entries())
    .map(([id, data]) => ({
      id,
      name: data.name,
      lessons: data.lessonsSet.size,
      students: data.studentsCount,
      salary: data.salaryAccrued,
    }))
    .sort((a, b) => b.salary - a.salary)

  const totalLessons = new Set(attendances.map((a) => a.lesson.id)).size
  const totalStudents = attendances.length
  const totalSalary = instructorRows.reduce((s, r) => s + r.salary, 0)

  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Сводный по педагогам</h1>
            <PageHelp pageKey="reports/salary/by-instructor" />
          </div>
          <p className="text-sm text-muted-foreground">Занятия, ученики и начисленная ЗП по инструкторам</p>
        </div>
        <MonthPicker />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Период:</span>
        <Badge variant="outline">{monthName}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Занятий проведено</p>
            <p className="text-2xl font-bold text-blue-600">{totalLessons}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Посещений учеников</p>
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

      {instructorRows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет данных
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Инструктор</TableHead>
                <TableHead className="text-right">Занятий</TableHead>
                <TableHead className="text-right">Учеников (посещений)</TableHead>
                <TableHead className="text-right">Начислено ЗП</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {instructorRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right">{r.lessons}</TableCell>
                  <TableCell className="text-right">{r.students}</TableCell>
                  <TableCell className="text-right">{formatMoney(r.salary)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-bold">
                <TableCell>Итого</TableCell>
                <TableCell className="text-right">{totalLessons}</TableCell>
                <TableCell className="text-right">{totalStudents}</TableCell>
                <TableCell className="text-right">{formatMoney(totalSalary)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
