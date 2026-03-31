import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, Users } from "lucide-react"
import { GroupTabs } from "./group-tabs"

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
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await getSession()
  const tenantId = session.user.tenantId

  const group = await db.group.findFirst({
    where: { id, tenantId, deletedAt: null },
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

  // Занятия за текущий месяц (UTC для корректного сравнения с DATE)
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const monthStart = new Date(Date.UTC(year, month, 1))
  const monthEnd = new Date(Date.UTC(year, month + 1, 0))

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

  // Зачисления
  const enrollments = await db.groupEnrollment.findMany({
    where: { groupId: id, tenantId, deletedAt: null },
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
    select: { id: true, firstName: true, lastName: true },
    orderBy: { lastName: "asc" },
  })

  // Клиенты для зачисления (для диалога)
  const clients = await db.client.findMany({
    where: { tenantId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      wards: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { lastName: "asc" },
    take: 200,
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

  const clientsForEnroll = clients.map((c) => ({
    id: c.id,
    name: [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени",
    phone: c.phone || "",
    wards: c.wards.map((w) => ({
      id: w.id,
      name: [w.lastName, w.firstName].filter(Boolean).join(" "),
    })),
  }))

  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const monthLabel = now.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/schedule/groups">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{group.name}</h1>
            {group.isActive ? (
              <Badge variant="default">Активна</Badge>
            ) : (
              <Badge variant="secondary">Архив</Badge>
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
      </div>

      {/* Tabs */}
      <GroupTabs
        groupId={id}
        lessons={lessonsData}
        enrollments={enrollmentsData}
        templates={templatesData}
        clients={clientsForEnroll}
        scheduleStr={scheduleStr}
        currentMonth={currentMonth}
        currentYear={currentYear}
        monthLabel={monthLabel}
        isActive={group.isActive}
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
        }}
      />
    </div>
  )
}
