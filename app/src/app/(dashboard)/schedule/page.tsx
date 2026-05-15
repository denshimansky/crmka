import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Plus, CalendarDays } from "lucide-react"
import { ScheduleWeekNav, type ScheduleView } from "./schedule-week-nav"
import { CancelDayDialog } from "./cancel-day-dialog"
import { SchedulePrintButton } from "@/components/schedule-print"
import { CopyMonthDialog } from "./copy-month-dialog"
import { PageHelp } from "@/components/page-help"
import { ScheduleFilterableGrid } from "./schedule-filters"

const ALLOWED_VIEWS = new Set<ScheduleView>(["rooms", "instructors", "directions", "list"])

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

const DIRECTION_COLORS: Record<number, string> = {
  0: "bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700",
  1: "bg-green-100 border-green-300 text-green-800 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700",
  2: "bg-purple-100 border-purple-300 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700",
  3: "bg-pink-100 border-pink-300 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-700",
  4: "bg-orange-100 border-orange-300 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700",
  5: "bg-teal-100 border-teal-300 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-700",
  6: "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700",
  7: "bg-red-100 border-red-300 text-red-800 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700",
}

function getColorForIndex(index: number): string {
  return DIRECTION_COLORS[index % Object.keys(DIRECTION_COLORS).length] || DIRECTION_COLORS[0]
}

function getWeekRange(offset: number = 0) {
  const today = new Date()
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + offset * 7)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { monday, sunday }
}

function formatWeekLabel(monday: Date, sunday: Date): string {
  const mDay = monday.getDate()
  const sDay = sunday.getDate()
  const mMonth = monday.toLocaleDateString("ru-RU", { month: "long" })
  const sMonth = sunday.toLocaleDateString("ru-RU", { month: "long" })
  const year = monday.getFullYear()
  if (mMonth === sMonth) {
    return `${mDay}–${sDay} ${mMonth} ${year}`
  }
  return `${mDay} ${mMonth} – ${sDay} ${sMonth} ${year}`
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string }>
}) {
  const sp = await searchParams
  const weekOffset = parseInt(sp.week || "0", 10) || 0
  const view: ScheduleView = ALLOWED_VIEWS.has(sp.view as ScheduleView)
    ? (sp.view as ScheduleView)
    : "rooms"

  const session = await getSession()
  const tenantId = session.user.tenantId

  const { monday, sunday } = getWeekRange(weekOffset)

  const branches = await db.branch.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  const lessons = await db.lesson.findMany({
    where: {
      tenantId,
      date: { gte: monday, lte: sunday },
      status: { not: "cancelled" },
    },
    include: {
      group: {
        include: {
          direction: true,
          room: true,
          _count: {
            select: { enrollments: { where: { isActive: true } } },
          },
        },
      },
      instructor: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  })

  // Collect unique rooms
  const roomMap = new Map<string, { id: string; name: string }>()
  for (const lesson of lessons) {
    if (!roomMap.has(lesson.group.room.id)) {
      roomMap.set(lesson.group.room.id, lesson.group.room)
    }
  }
  const rooms = Array.from(roomMap.values())

  // Collect unique directions
  const directionMap = new Map<string, { id: string; name: string }>()
  for (const lesson of lessons) {
    if (!directionMap.has(lesson.group.direction.id)) {
      directionMap.set(lesson.group.direction.id, {
        id: lesson.group.direction.id,
        name: lesson.group.direction.name,
      })
    }
  }
  const directions = Array.from(directionMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "ru")
  )

  // Collect unique instructors
  const instructorMap = new Map<string, { id: string; firstName: string | null; lastName: string }>()
  for (const lesson of lessons) {
    if (!instructorMap.has(lesson.instructor.id)) {
      instructorMap.set(lesson.instructor.id, lesson.instructor)
    }
  }
  const instructors = Array.from(instructorMap.values()).sort((a, b) =>
    a.lastName.localeCompare(b.lastName, "ru")
  )

  // Direction color map
  const directionIds = [...new Set(lessons.map((l) => l.group.directionId))]
  const directionColorMap: Record<string, string> = {}
  directionIds.forEach((id, i) => {
    directionColorMap[id] = getColorForIndex(i)
  })

  // Week days as ISO date strings
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d.toISOString().slice(0, 10)
  })

  const weekLabel = formatWeekLabel(monday, sunday)
  const hasLessons = lessons.length > 0
  const defaultDate = monday.toISOString().slice(0, 10)

  // Serialize lessons for client component (Date -> string)
  const serializedLessons = lessons.map((l) => ({
    id: l.id,
    date: l.date.toISOString().slice(0, 10),
    startTime: l.startTime,
    instructorId: l.instructorId,
    group: {
      name: l.group.name,
      directionId: l.group.directionId,
      maxStudents: l.group.maxStudents,
      room: { id: l.group.room.id, name: l.group.room.name },
      direction: { id: l.group.direction.id, name: l.group.direction.name },
      _count: { enrollments: l.group._count.enrollments },
    },
    instructor: {
      firstName: l.instructor.firstName,
      lastName: l.instructor.lastName,
    },
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Расписание</h1>
          <PageHelp pageKey="schedule" />
        </div>
        <div className="flex gap-2">
          <Link href="/schedule/groups">
            <Button variant="outline">Группы</Button>
          </Link>
          <Link href="/schedule/groups">
            <Button>
              <Plus className="mr-2 size-4" />
              Занятие
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <ScheduleWeekNav weekOffset={weekOffset} weekLabel={weekLabel} view={view} />
        </div>
        <CopyMonthDialog />
        <CancelDayDialog defaultDate={defaultDate} branches={branches} />
        <SchedulePrintButton />
      </div>

      {/* Occupancy legend */}
      {hasLessons && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="font-medium">Заполняемость:</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-green-500" /> &lt;70% — свободно</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-yellow-500" /> 70–90% — почти заполнена</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-500" /> &gt;90% — заполнена</span>
        </div>
      )}

      {/* Print-only header */}
      <div className="print-only hidden">
        <h2 className="text-lg font-bold text-center mb-2">
          Расписание на {weekLabel}
        </h2>
      </div>

      {!hasLessons ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <CalendarDays className="size-16 text-muted-foreground/50" />
          <div>
            <h2 className="text-lg font-semibold">Нет занятий на этой неделе</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Создайте группы и сгенерируйте расписание
            </p>
          </div>
          <Link href="/schedule/groups">
            <Button>Перейти к группам</Button>
          </Link>
        </div>
      ) : (
        <ScheduleFilterableGrid
          lessons={serializedLessons}
          rooms={rooms}
          directions={directions}
          instructors={instructors}
          weekDays={weekDays}
          dayNames={DAY_NAMES}
          directionColorMap={directionColorMap}
          view={view}
        />
      )}
    </div>
  )
}
