import { cookies } from "next/headers"
import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import {
  scopeBranch,
  scopeLesson,
  scopeLessonForInstructor,
  scopeRoom,
  scopeTrialLesson,
  isUnscoped,
} from "@/lib/branch-scope"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ScheduleWeekNav, type ScheduleView } from "./schedule-week-nav"
import { CancelDayDialog } from "./cancel-day-dialog"
import { StandaloneLessonDialog } from "./standalone-lesson-dialog"
import { SchedulePrintButton } from "@/components/schedule-print"
import { CopyMonthDialog } from "./copy-month-dialog"
import { PageHelp } from "@/components/page-help"
import { ScheduleFilterableGrid } from "./schedule-filters"
import {
  buildMonthGridFull,
  getMonthGridRange,
  offsetMonth,
  ymd,
} from "@/lib/date/month-grid"
import type { Prisma } from "@prisma/client"

const ALLOWED_VIEWS = new Set<ScheduleView>(["week", "month"])
const VIEW_COOKIE_NAME = "schedule_view"

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

function formatWeekLabelCompact(monday: Date, sunday: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(monday.getDate())}.${pad(monday.getMonth() + 1)} – ${pad(sunday.getDate())}.${pad(sunday.getMonth() + 1)}`
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; monthOffset?: string; view?: string; wardId?: string }>
}) {
  const sp = await searchParams
  const weekOffset = parseInt(sp.week || "0", 10) || 0
  const monthOffset = parseInt(sp.monthOffset || "0", 10) || 0
  // Период (Неделя/Месяц) персистится через cookie schedule_view (баг #41):
  // если в URL нет ?view, берём последний выбор пользователя; иначе — week.
  const cookieView = (await cookies()).get(VIEW_COOKIE_NAME)?.value
  const view: ScheduleView = ALLOWED_VIEWS.has(sp.view as ScheduleView)
    ? (sp.view as ScheduleView)
    : ALLOWED_VIEWS.has(cookieView as ScheduleView)
      ? (cookieView as ScheduleView)
      : "week"
  const wardIdFilter = sp.wardId && /^[0-9a-f-]{36}$/i.test(sp.wardId) ? sp.wardId : null

  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = await getBranchScope()
  // ADM-04: инструктор видит только свои занятия (instructorId=me либо
  // substituteInstructorId=me) и только в своих филиалах. Админ — только
  // в своих филиалах.
  const lessonScope =
    session.user.role === "instructor"
      ? scopeLessonForInstructor(session.user.employeeId, scope)
      : scopeLesson(scope)

  const { monday, sunday } = getWeekRange(weekOffset)

  // Развилка диапазона данных: для месяца захватываем целую сетку (включая
  // хвосты соседних месяцев), для недели — пн..вс.
  const monthMeta = view === "month" ? offsetMonth(monthOffset) : null
  const monthRange = monthMeta
    ? getMonthGridRange(monthMeta.year, monthMeta.month)
    : null
  const dateRange = monthRange
    ? { start: monthRange.gridStart, end: monthRange.gridEnd }
    : { start: monday, end: sunday }

  const branches = await db.branch.findMany({
    where: { tenantId, deletedAt: null, ...scopeBranch(scope) },
    select: { id: true, name: true, workingHoursStart: true, workingHoursEnd: true },
    orderBy: { name: "asc" },
  })

  // Диапазон часов для вида «По неделе» = объединение workingHours по всем филиалам.
  // Если филиал A работает 08:00–19:00, филиал B — 10:00–20:00, итог 08:00–20:00.
  // При отсутствии настроек — дефолт 08:00–21:00.
  function parseHour(time: string | null | undefined): number | null {
    if (!time) return null
    const [h] = time.split(":")
    const n = parseInt(h, 10)
    return Number.isFinite(n) && n >= 0 && n <= 23 ? n : null
  }
  const starts = branches.map((b) => parseHour(b.workingHoursStart)).filter((h): h is number => h !== null)
  const ends = branches.map((b) => parseHour(b.workingHoursEnd)).filter((h): h is number => h !== null)
  const weekHourStart = starts.length > 0 ? Math.min(...starts) : 8
  const weekHourEnd = ends.length > 0 ? Math.max(...ends) : 21

  // Все кабинеты организации с привязкой к филиалу — нужны для вида «По неделе»,
  // в котором кабинеты пустого филиала тоже должны отображаться столбцами.
  const allRoomsRaw = await db.room.findMany({
    where: { tenantId, deletedAt: null, ...scopeRoom(scope) },
    select: { id: true, name: true, branchId: true },
    orderBy: { name: "asc" },
  })

  // Список подопечных для селекта фильтра (с ФИО родителя для уникальности тёзок).
  // Берём только активных, чтобы не загромождать список архивом.
  // ADM-04: инструктор видит только детей своих групп (включая замены);
  // админ — только детей групп своих филиалов.
  const wardEnrollmentFilter: Prisma.GroupEnrollmentListRelationFilter | undefined =
    session.user.role === "instructor"
      ? {
          some: {
            isActive: true,
            deletedAt: null,
            group: {
              OR: [
                { instructorId: session.user.employeeId },
                { lessons: { some: { substituteInstructorId: session.user.employeeId } } },
              ],
              ...(isUnscoped(scope) ? {} : { branchId: { in: scope.branchIds } }),
            },
          },
        }
      : isUnscoped(scope)
        ? undefined
        : {
            some: {
              isActive: true,
              deletedAt: null,
              group: { branchId: { in: scope.branchIds } },
            },
          }

  const wardsForFilter = await db.ward.findMany({
    where: {
      tenantId,
      client: { deletedAt: null },
      ...(wardEnrollmentFilter ? { enrollments: wardEnrollmentFilter } : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      client: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 1000,
  })

  // scope и фильтр по wardId оба используют ключ `group` — собираем через AND,
  // чтобы не перезаписывать друг друга.
  const lessonExtraConditions: Prisma.LessonWhereInput[] = []
  if (Object.keys(lessonScope).length > 0) lessonExtraConditions.push(lessonScope)
  if (wardIdFilter) {
    lessonExtraConditions.push({
      group: {
        enrollments: {
          some: { wardId: wardIdFilter, isActive: true, deletedAt: null },
        },
      },
    })
  }

  const lessons = await db.lesson.findMany({
    where: {
      tenantId,
      date: { gte: dateRange.start, lte: dateRange.end },
      status: { not: "cancelled" },
      ...(lessonExtraConditions.length > 0 ? { AND: lessonExtraConditions } : {}),
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
      substituteInstructor: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  })

  // Доп. пассажиры занятий — пробные ученики и отработки, которые приходят в эту
  // конкретную дату. Группа сама по себе про них не знает (они не в enrollments),
  // поэтому счётчик «N/max» без них врёт (баг #50).
  const lessonIds = lessons.map((l) => l.id)
  const [trialRowsForLessons, scheduledMakeupRows, markedMakeupRows] =
    lessonIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          db.trialLesson.findMany({
            where: {
              tenantId,
              lessonId: { in: lessonIds },
              status: { in: ["scheduled", "attended"] },
            },
            select: { lessonId: true, clientId: true, wardId: true },
          }),
          db.attendance.findMany({
            where: {
              tenantId,
              scheduledMakeupLessonId: { in: lessonIds },
              attendanceType: { code: "makeup_scheduled" },
            },
            select: {
              scheduledMakeupLessonId: true,
              clientId: true,
              wardId: true,
            },
          }),
          db.attendance.findMany({
            where: {
              tenantId,
              lessonId: { in: lessonIds },
              isMakeup: true,
            },
            select: { lessonId: true, clientId: true, wardId: true },
          }),
        ])

  // dedup по (clientId, wardId) — иначе ребёнок с уже отмеченной отработкой
  // (и сохранившейся записью makeup_scheduled на источнике) посчитается дважды.
  const extraAttendeesByLesson = new Map<string, Set<string>>()
  function addExtra(lessonId: string | null, clientId: string, wardId: string | null) {
    if (!lessonId) return
    const key = `${clientId}:${wardId || ""}`
    let set = extraAttendeesByLesson.get(lessonId)
    if (!set) {
      set = new Set()
      extraAttendeesByLesson.set(lessonId, set)
    }
    set.add(key)
  }
  for (const t of trialRowsForLessons) addExtra(t.lessonId, t.clientId, t.wardId)
  for (const s of scheduledMakeupRows) addExtra(s.scheduledMakeupLessonId, s.clientId, s.wardId)
  for (const m of markedMakeupRows) addExtra(m.lessonId, m.clientId, m.wardId)

  // Индивидуальные пробные (без группы) — отображаются в общем расписании.
  // ADM-04: инструктор видит только своё (instructorId=me); админ — в своих
  // филиалах (через scopeTrialLesson).
  const trialBranchScope = scopeTrialLesson(scope)
  const individualTrials = await db.trialLesson.findMany({
    where: {
      tenantId,
      scheduledDate: { gte: dateRange.start, lte: dateRange.end },
      status: "scheduled",
      groupId: null,
      lessonId: null,
      ...(wardIdFilter ? { wardId: wardIdFilter } : {}),
      ...(session.user.role === "instructor"
        ? { instructorId: session.user.employeeId }
        : trialBranchScope),
    },
    select: {
      id: true,
      scheduledDate: true,
      startTime: true,
      durationMinutes: true,
      clientId: true,
      client: { select: { firstName: true, lastName: true } },
      ward: { select: { firstName: true, lastName: true } },
      direction: { select: { id: true, name: true } },
      instructor: { select: { id: true, firstName: true, lastName: true } },
      room: { select: { id: true, name: true } },
    },
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
  })

  // Collect unique directions (groups + individual trials)
  const directionMap = new Map<string, { id: string; name: string }>()
  for (const lesson of lessons) {
    if (!directionMap.has(lesson.group.direction.id)) {
      directionMap.set(lesson.group.direction.id, {
        id: lesson.group.direction.id,
        name: lesson.group.direction.name,
      })
    }
  }
  for (const t of individualTrials) {
    if (t.direction && !directionMap.has(t.direction.id)) {
      directionMap.set(t.direction.id, { id: t.direction.id, name: t.direction.name })
    }
  }
  const directions = Array.from(directionMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "ru")
  )

  // Collect unique instructors — на занятии с заменой преподаёт замещающий,
  // поэтому в фильтр попадает фактический педагог (замена ⟶ основной).
  const instructorMap = new Map<string, { id: string; firstName: string | null; lastName: string }>()
  for (const lesson of lessons) {
    const eff = lesson.substituteInstructor ?? lesson.instructor
    if (!instructorMap.has(eff.id)) {
      instructorMap.set(eff.id, eff)
    }
  }
  for (const t of individualTrials) {
    if (t.instructor && !instructorMap.has(t.instructor.id)) {
      instructorMap.set(t.instructor.id, t.instructor)
    }
  }
  const instructors = Array.from(instructorMap.values()).sort((a, b) =>
    a.lastName.localeCompare(b.lastName, "ru")
  )

  // Direction color map (включая направления индивидуальных пробных)
  const allDirectionIds = new Set<string>()
  for (const l of lessons) allDirectionIds.add(l.group.directionId)
  for (const t of individualTrials) if (t.direction) allDirectionIds.add(t.direction.id)
  const directionColorMap: Record<string, string> = {}
  Array.from(allDirectionIds).forEach((id, i) => {
    directionColorMap[id] = getColorForIndex(i)
  })

  // Week days as ISO date strings
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d.toISOString().slice(0, 10)
  })

  const weekLabel = formatWeekLabel(monday, sunday)
  const weekLabelCompact = formatWeekLabelCompact(monday, sunday)
  const hasLessons = lessons.length > 0 || individualTrials.length > 0
  const defaultDate = monday.toISOString().slice(0, 10)

  // Месячная сетка дней (для view=month) — 7×N клеток с учётом хвостов соседних месяцев.
  const gridDays = monthMeta
    ? buildMonthGridFull(monthMeta.year, monthMeta.month).map((c) => ({
        date: ymd(c.date),
        inCurrentMonth: c.inCurrentMonth,
      }))
    : []

  // Подписи для верхней навигации
  const monthLabel = monthMeta
    ? new Date(monthMeta.year, monthMeta.month, 1).toLocaleDateString("ru-RU", {
        month: "long",
        year: "numeric",
      })
    : ""
  const monthLabelCompact = monthMeta
    ? `${String(monthMeta.month + 1).padStart(2, "0")}.${monthMeta.year}`
    : ""

  // Serialize lessons for client component (Date -> string)
  // На занятии с заменой показываем замещающего педагога, а не основного.
  const serializedLessons = lessons.map((l) => {
    const eff = l.substituteInstructor ?? l.instructor
    return {
      id: l.id,
      date: l.date.toISOString().slice(0, 10),
      startTime: l.startTime,
      durationMinutes: l.durationMinutes,
      instructorId: eff.id,
      group: {
        name: l.group.name,
        directionId: l.group.directionId,
        maxStudents: l.group.maxStudents,
        room: { id: l.group.room.id, name: l.group.room.name },
        direction: { id: l.group.direction.id, name: l.group.direction.name },
        _count: {
          // «На занятие записано» = постоянные ученики группы + пробные + отработки.
          // Дедуплицировано по (clientId, wardId) выше — баг #50.
          enrollments:
            l.group._count.enrollments +
            (extraAttendeesByLesson.get(l.id)?.size ?? 0),
        },
      },
      instructor: {
        firstName: eff.firstName,
        lastName: eff.lastName,
      },
      isSubstitute: !!l.substituteInstructor,
    }
  })

  // Индивидуальные пробные — отдаём в той же форме, что и обычные занятия.
  // Группа синтетическая: имя из подопечного, 1 место занято.
  // Клик ведёт в карточку лида.
  const trialDirectionFallback =
    directions[0] ?? { id: "trial-fallback", name: "—" }
  const synthRoom = { id: "trial-no-room", name: "—" }
  const trialAsLessons = individualTrials.map((t) => {
    const wardName = t.ward
      ? [t.ward.lastName, t.ward.firstName].filter(Boolean).join(" ")
      : null
    const clientName =
      [t.client.lastName, t.client.firstName].filter(Boolean).join(" ") || "Лид"
    const direction = t.direction ?? trialDirectionFallback
    const instructor = t.instructor ?? { id: "trial-unknown", firstName: null, lastName: "—" }
    const room = t.room ?? synthRoom
    return {
      id: `trial-${t.id}`,
      date: t.scheduledDate.toISOString().slice(0, 10),
      startTime: t.startTime || "—",
      durationMinutes: t.durationMinutes ?? 60,
      instructorId: instructor.id,
      href: `/crm/clients/${t.clientId}`,
      isTrial: true as const,
      group: {
        name: `Пробное: ${wardName || clientName}`,
        directionId: direction.id,
        maxStudents: 1,
        room: { id: room.id, name: room.name },
        direction: { id: direction.id, name: direction.name },
        _count: { enrollments: 1 },
      },
      instructor: { firstName: instructor.firstName, lastName: instructor.lastName },
      isSubstitute: false,
    }
  })

  const allScheduleItems = [...serializedLessons, ...trialAsLessons].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    return a.startTime.localeCompare(b.startTime)
  })

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
          <StandaloneLessonDialog defaultDate={defaultDate} />

        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <ScheduleWeekNav
            weekOffset={weekOffset}
            weekLabel={weekLabel}
            weekLabelCompact={weekLabelCompact}
            monthOffset={monthOffset}
            monthLabel={monthLabel}
            monthLabelCompact={monthLabelCompact}
            view={view}
          />
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

      <ScheduleFilterableGrid
        lessons={allScheduleItems}
        allRooms={allRoomsRaw}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        directions={directions}
        instructors={instructors}
        wards={wardsForFilter.map((w) => ({
          id: w.id,
          firstName: w.firstName,
          lastName: w.lastName,
          parentName:
            [w.client.lastName, w.client.firstName].filter(Boolean).join(" ") ||
            "Без имени",
        }))}
        currentWardId={wardIdFilter}
        weekDays={weekDays}
        dayNames={DAY_NAMES}
        gridDays={gridDays}
        directionColorMap={directionColorMap}
        view={view}
        weekHourStart={weekHourStart}
        weekHourEnd={weekHourEnd}
      />
      {!hasLessons && (
        <p className="py-2 text-center text-sm text-muted-foreground">
          На выбранный период нет занятий
        </p>
      )}
    </div>
  )
}
