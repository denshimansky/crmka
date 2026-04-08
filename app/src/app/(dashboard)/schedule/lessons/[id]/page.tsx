import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowLeft, Clock, MapPin, User, BookOpen } from "lucide-react"
import { AttendanceTable } from "./attendance-table"
import { PageHelp } from "@/components/page-help"

const LESSON_STATUS_LABELS: Record<string, string> = {
  scheduled: "Запланировано",
  completed: "Проведено",
  cancelled: "Отменено",
}

const LESSON_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  scheduled: "secondary",
  completed: "default",
  cancelled: "destructive",
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " \u20BD"
}

export default async function LessonCardPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await getSession()
  const tenantId = session.user.tenantId

  const lesson = await db.lesson.findFirst({
    where: { id, tenantId },
    include: {
      group: {
        include: {
          direction: { select: { id: true, name: true, lessonPrice: true } },
          room: { select: { id: true, name: true } },
        },
      },
      instructor: { select: { id: true, firstName: true, lastName: true } },
      attendances: {
        include: {
          attendanceType: true,
          subscription: { select: { id: true, lessonPrice: true, balance: true } },
        },
      },
    },
  })

  if (!lesson) notFound()

  // Get enrolled students
  const enrollments = await db.groupEnrollment.findMany({
    where: {
      groupId: lesson.groupId,
      tenantId,
      isActive: true,
      deletedAt: null,
    },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, phone: true } },
      ward: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  // Get subscriptions for this period
  const lessonDate = new Date(lesson.date)
  const periodYear = lessonDate.getFullYear()
  const periodMonth = lessonDate.getMonth() + 1

  const subscriptions = await db.subscription.findMany({
    where: {
      tenantId,
      groupId: lesson.groupId,
      periodYear,
      periodMonth,
      deletedAt: null,
      status: { in: ["active", "pending"] },
    },
    select: {
      id: true,
      clientId: true,
      wardId: true,
      lessonPrice: true,
      balance: true,
    },
  })

  // Get attendance types
  const attendanceTypes = await db.attendanceType.findMany({
    where: {
      OR: [{ tenantId: null }, { tenantId }],
      isActive: true,
    },
    orderBy: { sortOrder: "asc" },
  })

  // Get salary rate
  const salaryRate = await db.salaryRate.findFirst({
    where: {
      tenantId,
      employeeId: lesson.instructorId,
      directionId: lesson.group.directionId,
    },
  })

  // Build serialized data for client component
  const students = enrollments.map((enrollment) => {
    const attendance = lesson.attendances.find(
      (a) => a.clientId === enrollment.clientId && (
        enrollment.wardId ? a.wardId === enrollment.wardId : !a.wardId
      )
    )

    const subscription = subscriptions.find(
      (s) => s.clientId === enrollment.clientId && (
        enrollment.wardId ? s.wardId === enrollment.wardId : !s.wardId
      )
    )

    const lessonPrice = subscription
      ? Number(subscription.lessonPrice)
      : Number(lesson.group.direction.lessonPrice)

    return {
      enrollmentId: enrollment.id,
      clientId: enrollment.clientId,
      clientName: [enrollment.client.lastName, enrollment.client.firstName].filter(Boolean).join(" ") || "Без имени",
      clientPhone: enrollment.client.phone || null,
      wardId: enrollment.wardId,
      wardName: enrollment.ward
        ? [enrollment.ward.lastName, enrollment.ward.firstName].filter(Boolean).join(" ")
        : null,
      subscriptionId: subscription?.id || null,
      lessonPrice,
      attendance: attendance
        ? {
            id: attendance.id,
            attendanceTypeId: attendance.attendanceTypeId,
            attendanceTypeName: attendance.attendanceType.name,
            attendanceTypeCode: attendance.attendanceType.code,
            chargeAmount: Number(attendance.chargeAmount),
            instructorPayAmount: Number(attendance.instructorPayAmount),
            instructorPayEnabled: attendance.instructorPayEnabled,
          }
        : null,
    }
  })

  const attendanceTypesData = attendanceTypes.map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    chargesSubscription: t.chargesSubscription,
    paysInstructor: t.paysInstructor,
  }))

  const salaryRateData = salaryRate
    ? {
        scheme: salaryRate.scheme,
        ratePerStudent: salaryRate.ratePerStudent ? Number(salaryRate.ratePerStudent) : null,
        ratePerLesson: salaryRate.ratePerLesson ? Number(salaryRate.ratePerLesson) : null,
        fixedPerShift: salaryRate.fixedPerShift ? Number(salaryRate.fixedPerShift) : null,
      }
    : null

  const instructorName = [lesson.instructor.lastName, lesson.instructor.firstName].filter(Boolean).join(" ")

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/schedule">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{lesson.group.name}</h1>
            <PageHelp pageKey="schedule/lessons/[id]" />
            <Badge variant={LESSON_STATUS_VARIANT[lesson.status] || "secondary"}>
              {LESSON_STATUS_LABELS[lesson.status] || lesson.status}
            </Badge>
            {lesson.isTrial && <Badge variant="outline">Пробное</Badge>}
            {lesson.isMakeup && <Badge variant="outline">Отработка</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {lesson.group.direction.name}
          </p>
        </div>
      </div>

      {/* Lesson info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="size-5 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Дата и время</div>
              <div className="text-sm font-medium">
                {formatDate(lessonDate)}
              </div>
              <div className="text-sm">
                {lesson.startTime} ({lesson.durationMinutes} мин)
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <MapPin className="size-5 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Кабинет</div>
              <div className="text-sm font-medium">{lesson.group.room.name}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <User className="size-5 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Педагог</div>
              <div className="text-sm font-medium">{instructorName}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <BookOpen className="size-5 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Учеников</div>
              <div className="text-sm font-medium">{enrollments.length}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Attendance table (client component) */}
      <AttendanceTable
        lessonId={id}
        topic={lesson.topic}
        homework={lesson.homework}
        students={students}
        attendanceTypes={attendanceTypesData}
        salaryRate={salaryRateData}
      />
    </div>
  )
}
