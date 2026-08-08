import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import { notFound } from "next/navigation"
import { isUnscoped } from "@/lib/branch-scope"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, Users } from "lucide-react"
import { GroupTabs } from "./group-tabs"
import { GroupSalaryRateButton } from "./group-salary-rate-button"
import { PageHelp } from "@/components/page-help"
import { getMonthFromParams } from "@/lib/month-params"
import { isGroupRateLocked } from "@/lib/salary/group-rate-lock"

const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

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
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export default async function GroupCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  // Месяц из URL (?year&month, 1-based) — переключатель MonthPicker в шапке
  // табов (баг #84). По умолчанию — текущий месяц.
  const { year, month } = getMonthFromParams(await searchParams)
  const session = await getSession()
  const tenantId = session.user.tenantId

  const group = await db.group.findFirst({
    where: { id, tenantId },
    include: {
      direction: true,
      branch: true,
      room: true,
      instructor: { select: { id: true, firstName: true, lastName: true } },
      templates: { orderBy: { dayOfWeek: "asc" } },
      _count: { select: { enrollments: { where: { isActive: true } } } },
    },
  })

  if (!group) notFound()

  // ADM-04: проверка доступа.
  // — Инструктор видит только свои группы (instructorId=me либо назначен как
  //   substitute на любое из занятий группы).
  // — Админ с ограниченным scope — только группы своих филиалов.
  const scope = await getBranchScope()
  if (session.user.role === "instructor") {
    let isOwn = group.instructorId === session.user.employeeId
    if (!isOwn) {
      const substituteLesson = await db.lesson.findFirst({
        where: { groupId: group.id, substituteInstructorId: session.user.employeeId },
        select: { id: true },
      })
      isOwn = !!substituteLesson
    }
    if (!isOwn) notFound()
  } else if (!isUnscoped(scope)) {
    if (!scope.branchIds.includes(group.branchId)) notFound()
  }

  // Занятия за выбранный месяц (UTC для корректного сравнения с DATE).
  // month из getMonthFromParams — 1-based.
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))

  const lessons = await db.lesson.findMany({
    where: {
      groupId: id,
      tenantId,
      date: { gte: monthStart, lte: monthEnd },
    },
    include: {
      instructor: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  })

  // Зачисления, актуальные на выбранный месяц: зачисленные не позже конца
  // месяца (enrolledAt <= monthEnd) — при просмотре прошлого месяца более
  // поздние ученики не показываются; для текущего/будущего — весь состав.
  // Статус оплаты и active/выбыл берутся по текущему состоянию зачисления.
  const enrollments = await db.groupEnrollment.findMany({
    where: { groupId: id, tenantId, deletedAt: null, enrolledAt: { lte: monthEnd } },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, phone: true } },
      ward: { select: { id: true, firstName: true, lastName: true, birthDate: true } },
    },
    orderBy: { enrolledAt: "desc" },
  })

  // Направления, филиалы с кабинетами, инструкторы (для редактирования группы)
  const directions = await db.direction.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true, lessonDuration: true },
    orderBy: { name: "asc" },
  })
  const branches = await db.branch.findMany({
    where: { tenantId, deletedAt: null },
    include: { rooms: { where: { deletedAt: null }, select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  })
  const instructors = await db.employee.findMany({
    where: { tenantId, deletedAt: null, role: { in: ["instructor", "owner", "manager"] } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeBranches: { select: { branchId: true } },
    },
    orderBy: { lastName: "asc" },
  })

  // Все группы для перевода
  const allGroups = await db.group.findMany({
    where: { tenantId, deletedAt: null, isActive: true },
    select: {
      id: true,
      name: true,
      maxStudents: true,
      direction: { select: { name: true } },
      _count: { select: { enrollments: { where: { isActive: true } } } },
    },
    orderBy: { name: "asc" },
  })

  const instructorName = `${group.instructor.lastName} ${group.instructor.firstName}`
  const enrolled = group._count.enrollments
  const scheduleStr = group.templates
    .map((t) => `${DAY_SHORT[t.dayOfWeek]} ${t.startTime}`)
    .join(", ")

  // Сериализация для клиентского компонента
  const lessonsData = lessons.map((l) => ({
    id: l.id,
    date: formatDate(l.date),
    startTime: l.startTime,
    durationMinutes: l.durationMinutes,
    status: l.status,
    statusLabel: LESSON_STATUS_LABELS[l.status] || l.status,
    statusVariant: LESSON_STATUS_VARIANT[l.status] || "secondary" as const,
    instructor: `${l.instructor.lastName} ${l.instructor.firstName}`,
  }))

  const enrollmentsData = enrollments.map((e) => ({
    id: e.id,
    clientId: e.client.id,
    wardId: e.ward?.id ?? null,
    clientName: [e.client.lastName, e.client.firstName].filter(Boolean).join(" ") || "—",
    clientPhone: e.client.phone || "—",
    wardName: e.ward
      ? [e.ward.lastName, e.ward.firstName].filter(Boolean).join(" ")
      : null,
    wardBirthDate: e.ward?.birthDate
      ? formatDateShort(e.ward.birthDate)
      : null,
    enrolledAt: formatDateShort(e.enrolledAt),
    isActive: e.isActive,
    paymentStatus: e.paymentStatus,
  }))

  const templatesData = group.templates.map((t) => ({
    id: t.id,
    dayOfWeek: t.dayOfWeek,
    dayLabel: DAY_SHORT[t.dayOfWeek],
    startTime: t.startTime,
    durationMinutes: t.durationMinutes,
  }))

  const currentMonth = month
  const currentYear = year
  const monthLabel = new Date(Date.UTC(year, month - 1, 1))
    .toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  // Замок ставки группы: если в группе уже есть реальная отметка — задавать/менять
  // ставку нельзя. Схему действующей ставки берём для лейбла кнопки.
  const [rateLocked, groupRate] = await Promise.all([
    isGroupRateLocked(db, tenantId, id),
    db.groupSalaryRate.findUnique({ where: { groupId: id }, select: { scheme: true } }),
  ])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4 gap-y-2">
        <Link href="/schedule/groups">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3 gap-y-2">
            <h1 className="text-2xl font-bold">{group.name}</h1>
            <PageHelp pageKey="schedule/groups/[id]" />
            {group.deletedAt ? (
              <Badge variant="outline">Архив</Badge>
            ) : group.isActive ? (
              <Badge variant="default">Активна</Badge>
            ) : (
              <Badge variant="secondary">Неактивна</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {group.direction.name} · {group.room.name} · {instructorName}
          </p>
        </div>
        <Card className="px-4 py-2">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <span className="text-lg font-bold">
              {enrolled}/{group.maxStudents}
            </span>
          </div>
        </Card>
        <GroupSalaryRateButton
          groupId={id}
          groupName={group.name}
          locked={rateLocked}
          initialScheme={groupRate?.scheme ?? null}
        />
      </div>

      {/* Tabs */}
      <GroupTabs
        groupId={id}
        lessons={lessonsData}
        enrollments={enrollmentsData}
        templates={templatesData}
        scheduleStr={scheduleStr}
        currentMonth={currentMonth}
        currentYear={currentYear}
        monthLabel={monthLabel}
        isActive={group.isActive}
        isArchived={group.deletedAt !== null}
        directions={directions}
        branches={branches.map((b) => ({
          id: b.id,
          name: b.name,
          rooms: b.rooms,
        }))}
        instructors={instructors}
        groupInfo={{
          id: group.id,
          name: group.name,
          directionId: group.directionId,
          branchId: group.branchId,
          roomId: group.roomId,
          instructorId: group.instructorId,
          maxStudents: group.maxStudents,
          startDate: group.startDate
            ? group.startDate.toISOString().slice(0, 10)
            : null,
          endDate: group.endDate
            ? group.endDate.toISOString().slice(0, 10)
            : null,
        }}
        groupsForTransfer={allGroups
          .filter((g) => g.id !== id)
          .map((g) => ({
            id: g.id,
            name: g.name,
            directionName: g.direction.name,
            enrolled: g._count.enrollments,
            maxStudents: g.maxStudents,
          }))}
      />
    </div>
  )
}
