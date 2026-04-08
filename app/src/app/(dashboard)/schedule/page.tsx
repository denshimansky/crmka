import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, CalendarDays } from "lucide-react"
import { ScheduleWeekNav } from "./schedule-week-nav"
import { PageHelp } from "@/components/page-help"

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

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("ru-RU", { day: "numeric" })
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
  searchParams: Promise<{ week?: string }>
}) {
  const sp = await searchParams
  const weekOffset = parseInt(sp.week || "0", 10) || 0

  const session = await getSession()
  const tenantId = session.user.tenantId

  const { monday, sunday } = getWeekRange(weekOffset)

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
      instructor: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  })

  // Собираем уникальные кабинеты
  const roomMap = new Map<string, { id: string; name: string }>()
  for (const lesson of lessons) {
    if (!roomMap.has(lesson.group.room.id)) {
      roomMap.set(lesson.group.room.id, lesson.group.room)
    }
  }
  const rooms = Array.from(roomMap.values())

  // Цвета для направлений
  const directionIds = [...new Set(lessons.map((l) => l.group.directionId))]
  const directionColorMap = new Map<string, string>()
  directionIds.forEach((id, i) => directionColorMap.set(id, getColorForIndex(i)))

  // Дни недели с датами
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })

  const weekLabel = formatWeekLabel(monday, sunday)
  const hasLessons = lessons.length > 0

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

      <ScheduleWeekNav weekOffset={weekOffset} weekLabel={weekLabel} />

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
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="grid gap-px bg-border" style={{ gridTemplateColumns: `120px repeat(7, 1fr)` }}>
              {/* Header */}
              <div className="bg-background p-2" />
              {weekDays.map((day, i) => (
                <div key={i} className="bg-background p-2 text-center text-sm font-medium">
                  {DAY_NAMES[i]} {formatDateShort(day)}
                </div>
              ))}

              {/* Rows by room */}
              {rooms.map((room) => (
                <>
                  <div key={room.id} className="bg-background p-2 text-sm font-medium text-muted-foreground">
                    {room.name}
                  </div>
                  {weekDays.map((day, di) => {
                    const dayStr = day.toISOString().slice(0, 10)
                    const dayLessons = lessons.filter(
                      (l) =>
                        l.group.room.id === room.id &&
                        l.date.toISOString().slice(0, 10) === dayStr
                    )
                    return (
                      <div key={`${room.id}-${di}`} className="min-h-[100px] bg-background p-1 space-y-1">
                        {dayLessons.map((lesson) => {
                          const colorClass = directionColorMap.get(lesson.group.directionId) || DIRECTION_COLORS[0]
                          const enrolled = lesson.group._count.enrollments
                          const max = lesson.group.maxStudents
                          const instructorName = [lesson.instructor.lastName, lesson.instructor.firstName?.[0] + "."]
                            .filter(Boolean)
                            .join(" ")
                          return (
                            <Link key={lesson.id} href={`/schedule/lessons/${lesson.id}`}>
                              <Card className={`cursor-pointer border p-2 text-xs ${colorClass} hover:opacity-80`}>
                                <div className="font-bold">{lesson.startTime}</div>
                                <div className="font-medium">{lesson.group.name}</div>
                                <div className="opacity-70">{instructorName}</div>
                                <div className="mt-1 flex items-center justify-between">
                                  <span>{enrolled}/{max}</span>
                                  {enrolled / max > 0.8 && (
                                    <Badge variant="destructive" className="h-4 px-1 text-[10px]">!</Badge>
                                  )}
                                </div>
                              </Card>
                            </Link>
                          )
                        })}
                      </div>
                    )
                  })}
                </>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
