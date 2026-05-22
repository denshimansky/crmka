"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { CalendarDays, X, Filter } from "lucide-react"
import type { ScheduleView } from "./schedule-week-nav"

interface Room {
  id: string
  name: string
}

interface Direction {
  id: string
  name: string
}

interface Instructor {
  id: string
  firstName: string | null
  lastName: string
}

interface LessonData {
  id: string
  date: string // ISO date string YYYY-MM-DD
  startTime: string
  durationMinutes: number
  instructorId: string
  href?: string // если задан — переопределяет ссылку (например, для индивидуальных пробных)
  isTrial?: boolean
  group: {
    name: string
    directionId: string
    maxStudents: number
    room: Room
    direction: Direction
    _count: { enrollments: number }
  }
  instructor: {
    firstName: string | null
    lastName: string
  }
}

interface Branch {
  id: string
  name: string
}

interface RoomWithBranch {
  id: string
  name: string
  branchId: string
}

interface ScheduleFiltersProps {
  lessons: LessonData[]
  rooms: Room[]
  allRooms: RoomWithBranch[]
  branches: Branch[]
  directions: Direction[]
  instructors: Instructor[]
  weekDays: string[] // ISO date strings
  dayNames: string[]
  directionColorMap: Record<string, string>
  view: ScheduleView
  // Объединённый диапазон часов работы филиалов (для вида «По неделе»)
  weekHourStart: number
  weekHourEnd: number
}

function getOccupancyStyle(enrolled: number, max: number): { className: string; label: string } {
  if (max === 0) return { className: "border-l-4 border-l-gray-400", label: "—" }
  const ratio = enrolled / max
  if (ratio > 0.9) {
    return { className: "border-l-4 border-l-red-500", label: "заполнена" }
  }
  if (ratio >= 0.7) {
    return { className: "border-l-4 border-l-yellow-500", label: "почти заполнена" }
  }
  return { className: "border-l-4 border-l-green-500", label: "свободно" }
}

export function ScheduleFilterableGrid({
  lessons,
  rooms,
  allRooms,
  branches,
  directions,
  instructors,
  weekDays,
  dayNames,
  directionColorMap,
  view,
  weekHourStart,
  weekHourEnd,
}: ScheduleFiltersProps) {
  const [roomFilter, setRoomFilter] = useState<string>("")
  const [directionFilter, setDirectionFilter] = useState<string>("")
  const [instructorFilter, setInstructorFilter] = useState<string>("")
  const [branchFilter, setBranchFilter] = useState<string>(() => branches[0]?.id || "")

  const hasFilters = !!(roomFilter || directionFilter || instructorFilter)

  const filteredLessons = useMemo(() => {
    return lessons.filter((l) => {
      if (roomFilter && l.group.room.id !== roomFilter) return false
      if (directionFilter && l.group.directionId !== directionFilter) return false
      if (instructorFilter && l.instructorId !== instructorFilter) return false
      return true
    })
  }, [lessons, roomFilter, directionFilter, instructorFilter])

  // Group key picker per view
  function getRowKey(lesson: LessonData): string {
    if (view === "instructors") return lesson.instructorId
    if (view === "directions") return lesson.group.directionId
    return lesson.group.room.id // rooms (default)
  }

  type Row = { id: string; label: string }

  const visibleRows: Row[] = useMemo(() => {
    if (view === "list") return []
    const ids = new Set(filteredLessons.map(getRowKey))
    if (view === "instructors") {
      return instructors
        .filter((i) => ids.has(i.id))
        .map((i) => ({
          id: i.id,
          label: `${i.lastName} ${i.firstName?.[0] || ""}.`.trim(),
        }))
    }
    if (view === "directions") {
      return directions
        .filter((d) => ids.has(d.id))
        .map((d) => ({ id: d.id, label: d.name }))
    }
    return rooms.filter((r) => ids.has(r.id)).map((r) => ({ id: r.id, label: r.name }))
  }, [filteredLessons, view, rooms, instructors, directions])

  const sortedListLessons = useMemo(() => {
    if (view !== "list") return []
    return [...filteredLessons].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return a.startTime.localeCompare(b.startTime)
    })
  }, [filteredLessons, view])

  const rowHeaderLabel = view === "instructors" ? "Педагог" : view === "directions" ? "Направление" : "Кабинет"

  function clearFilters() {
    setRoomFilter("")
    setDirectionFilter("")
    setInstructorFilter("")
  }

  function formatDateShort(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00")
    return d.toLocaleDateString("ru-RU", { day: "numeric" })
  }

  const activeFilterLabels: { label: string; onClear: () => void }[] = []
  if (roomFilter) {
    const room = rooms.find((r) => r.id === roomFilter)
    activeFilterLabels.push({
      label: `Кабинет: ${room?.name || "?"}`,
      onClear: () => setRoomFilter(""),
    })
  }
  if (directionFilter) {
    const dir = directions.find((d) => d.id === directionFilter)
    activeFilterLabels.push({
      label: `Направление: ${dir?.name || "?"}`,
      onClear: () => setDirectionFilter(""),
    })
  }
  if (instructorFilter) {
    const instr = instructors.find((i) => i.id === instructorFilter)
    activeFilterLabels.push({
      label: `Педагог: ${instr ? `${instr.lastName} ${instr.firstName?.[0] || ""}.` : "?"}`,
      onClear: () => setInstructorFilter(""),
    })
  }

  return (
    <>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="size-4 text-muted-foreground" />
        {view === "week" ? (
          <Select
            value={branchFilter}
            onValueChange={(v) => {
              if (v) setBranchFilter(v)
            }}
          >
            <SelectTrigger className="w-[220px]">
              {branchFilter ? (
                branches.find((b) => b.id === branchFilter)?.name || "Филиал"
              ) : (
                <span className="text-muted-foreground">Филиал</span>
              )}
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Select value={roomFilter} onValueChange={(v) => setRoomFilter(v ?? "")}>
            <SelectTrigger className="w-[180px]">
              {roomFilter ? (
                rooms.find((r) => r.id === roomFilter)?.name || "Кабинет"
              ) : (
                <span className="text-muted-foreground">Кабинет</span>
              )}
            </SelectTrigger>
            <SelectContent>
              {rooms.map((room) => (
                <SelectItem key={room.id} value={room.id}>
                  {room.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={directionFilter} onValueChange={(v) => setDirectionFilter(v ?? "")}>
          <SelectTrigger className="w-[180px]">
            {directionFilter ? (
              directions.find((d) => d.id === directionFilter)?.name || "Направление"
            ) : (
              <span className="text-muted-foreground">Направление</span>
            )}
          </SelectTrigger>
          <SelectContent>
            {directions.map((dir) => (
              <SelectItem key={dir.id} value={dir.id}>
                {dir.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={instructorFilter} onValueChange={(v) => setInstructorFilter(v ?? "")}>
          <SelectTrigger className="w-[200px]">
            {(() => {
              const instr = instructors.find((i) => i.id === instructorFilter)
              if (!instr) return <span className="text-muted-foreground">Педагог</span>
              return `${instr.lastName} ${instr.firstName?.[0] || ""}.`.trim()
            })()}
          </SelectTrigger>
          <SelectContent>
            {instructors.map((instr) => (
              <SelectItem key={instr.id} value={instr.id}>
                {instr.lastName} {instr.firstName?.[0]}.
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-1 size-3" />
            Сбросить фильтры
          </Button>
        )}
      </div>

      {/* Active filter badges */}
      {activeFilterLabels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {activeFilterLabels.map((f) => (
            <Badge
              key={f.label}
              variant="secondary"
              className="cursor-pointer gap-1 pr-1"
              onClick={f.onClear}
            >
              {f.label}
              <X className="size-3" />
            </Badge>
          ))}
        </div>
      )}

      {/* Grid */}
      {view === "week" ? (
        <WeekRoomsView
          lessons={filteredLessons}
          allRooms={allRooms}
          branches={branches}
          branchId={branchFilter}
          weekDays={weekDays}
          dayNames={dayNames}
          directionColorMap={directionColorMap}
          formatDateShort={formatDateShort}
          hourStart={weekHourStart}
          hourEnd={weekHourEnd}
        />
      ) : filteredLessons.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <CalendarDays className="size-16 text-muted-foreground/50" />
          <div>
            <h2 className="text-lg font-semibold">
              {hasFilters ? "Нет занятий по выбранным фильтрам" : "Нет занятий на этой неделе"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {hasFilters
                ? "Попробуйте изменить параметры фильтрации"
                : "Создайте группы и сгенерируйте расписание"}
            </p>
          </div>
          {hasFilters ? (
            <Button variant="outline" onClick={clearFilters}>
              Сбросить фильтры
            </Button>
          ) : (
            <Link href="/schedule/groups">
              <Button>Перейти к группам</Button>
            </Link>
          )}
        </div>
      ) : view === "list" ? (
        <div className="space-y-2">
          {sortedListLessons.map((lesson) => {
            const colorClass = directionColorMap[lesson.group.directionId] || ""
            const enrolled = lesson.group._count.enrollments
            const max = lesson.group.maxStudents
            const occupancy = getOccupancyStyle(enrolled, max)
            const instructorName = [
              lesson.instructor.lastName,
              lesson.instructor.firstName?.[0] ? lesson.instructor.firstName[0] + "." : "",
            ]
              .filter(Boolean)
              .join(" ")
            const dayIdx = weekDays.indexOf(lesson.date)
            const dayLabel = dayIdx >= 0 ? `${dayNames[dayIdx]} ${formatDateShort(lesson.date)}` : lesson.date
            return (
              <Link key={lesson.id} href={lesson.href || `/schedule/lessons/${lesson.id}`}>
                <Card
                  className={`flex flex-wrap items-center gap-3 cursor-pointer border p-3 text-sm ${colorClass} ${occupancy.className} hover:opacity-80`}
                  title={occupancy.label}
                >
                  <div className="font-bold w-20 shrink-0">{dayLabel}</div>
                  <div className="font-bold w-14 shrink-0">{lesson.startTime}</div>
                  <div className="font-medium flex-1 min-w-[150px] flex items-center gap-1.5">
                    {lesson.group.name}
                    {lesson.isTrial && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-300 text-blue-700 dark:text-blue-400">
                        пробное
                      </Badge>
                    )}
                  </div>
                  <div className="opacity-70 w-32 shrink-0">{instructorName}</div>
                  <div className="opacity-70 w-28 shrink-0">{lesson.group.room.name}</div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold">{enrolled}/{max}</span>
                    {max > 0 && enrolled / max > 0.9 && (
                      <Badge variant="destructive" className="h-4 px-1 text-[10px]">!</Badge>
                    )}
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div
              className="grid gap-px bg-border"
              style={{ gridTemplateColumns: `160px repeat(7, 1fr)` }}
            >
              {/* Header */}
              <div className="bg-background p-2 text-xs font-medium text-muted-foreground">
                {rowHeaderLabel}
              </div>
              {weekDays.map((day, i) => (
                <div key={i} className="bg-background p-2 text-center text-sm font-medium">
                  {dayNames[i]} {formatDateShort(day)}
                </div>
              ))}

              {/* Rows by selected dimension */}
              {visibleRows.map((row) => (
                <div key={row.id} className="contents">
                  <div className="bg-background p-2 text-sm font-medium text-muted-foreground">
                    {row.label}
                  </div>
                  {weekDays.map((dayStr, di) => {
                    const dayLessons = filteredLessons.filter(
                      (l) => getRowKey(l) === row.id && l.date === dayStr
                    )
                    return (
                      <div
                        key={`${row.id}-${di}`}
                        className="min-h-[100px] bg-background p-1 space-y-1"
                      >
                        {dayLessons.map((lesson) => {
                          const colorClass =
                            directionColorMap[lesson.group.directionId] || ""
                          const enrolled = lesson.group._count.enrollments
                          const max = lesson.group.maxStudents
                          const occupancy = getOccupancyStyle(enrolled, max)
                          const instructorName = [
                            lesson.instructor.lastName,
                            lesson.instructor.firstName?.[0] ? lesson.instructor.firstName[0] + "." : "",
                          ]
                            .filter(Boolean)
                            .join(" ")
                          return (
                            <Link key={lesson.id} href={lesson.href || `/schedule/lessons/${lesson.id}`}>
                              <Card
                                className={`cursor-pointer border p-2 text-xs ${colorClass} ${occupancy.className} hover:opacity-80`}
                                title={occupancy.label}
                              >
                                <div className="font-bold flex items-center justify-between gap-1">
                                  <span>{lesson.startTime}</span>
                                  {lesson.isTrial && (
                                    <Badge variant="outline" className="h-4 px-1 text-[9px] border-blue-300 text-blue-700 dark:text-blue-400">
                                      проб
                                    </Badge>
                                  )}
                                </div>
                                <div className="font-medium">{lesson.group.name}</div>
                                <div className="opacity-70">
                                  {view === "instructors" ? lesson.group.room.name : instructorName}
                                </div>
                                <div className="mt-1 flex items-center justify-between">
                                  <span className="font-semibold">
                                    {enrolled}/{max}
                                  </span>
                                  {max > 0 && enrolled / max > 0.9 && (
                                    <Badge
                                      variant="destructive"
                                      className="h-4 px-1 text-[10px]"
                                    >
                                      !
                                    </Badge>
                                  )}
                                </div>
                              </Card>
                            </Link>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Вид «По неделе» ───
// Строки = часы от hourStart до hourEnd (объединение working hours филиалов),
// столбцы = (день недели) × (кабинеты выбранного филиала).
// Карточка занятия позиционируется абсолютно внутри столбца «день-кабинет»:
//   top    = (часы от hourStart) * CELL_HEIGHT + (минуты начала / 60) * CELL_HEIGHT
//   height = (длительность / 60) * CELL_HEIGHT  (45 мин = 3/4 ячейки, 30 мин = 1/2)
const CELL_HEIGHT = 64

interface WeekRoomsViewProps {
  lessons: LessonData[]
  allRooms: RoomWithBranch[]
  branches: Branch[]
  branchId: string
  weekDays: string[]
  dayNames: string[]
  directionColorMap: Record<string, string>
  formatDateShort: (dateStr: string) => string
  hourStart: number
  hourEnd: number
}

function WeekRoomsView({
  lessons,
  allRooms,
  branches,
  branchId,
  weekDays,
  dayNames,
  directionColorMap,
  formatDateShort,
  hourStart,
  hourEnd,
}: WeekRoomsViewProps) {
  // Если занятие начинается до/после рабочих часов филиалов — расширяем сетку,
  // чтобы оно не пропало из виду (например, лид-занятие в 7:30 при филиале 8–21).
  let effStart = hourStart
  let effEnd = hourEnd
  for (const l of lessons) {
    const [hStr] = l.startTime.split(":")
    const h = parseInt(hStr, 10)
    if (Number.isFinite(h)) {
      if (h < effStart) effStart = h
      if (h > effEnd) effEnd = h
    }
  }
  if (effStart >= effEnd) effEnd = effStart + 1
  const HOURS = Array.from({ length: effEnd - effStart + 1 }, (_, i) => effStart + i)
  if (branches.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        В организации нет филиалов. Добавьте филиал и кабинеты в настройках.
      </div>
    )
  }

  const branchRooms = allRooms.filter((r) => r.branchId === branchId)

  if (branchRooms.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        В филиале нет кабинетов. Добавьте кабинеты в настройках филиала.
      </div>
    )
  }

  const roomsCount = branchRooms.length
  const colCount = weekDays.length * roomsCount

  return (
    <div className="overflow-x-auto">
      <div
        className="grid border-l border-t bg-background"
        style={{
          gridTemplateColumns: `60px repeat(${colCount}, minmax(120px, 1fr))`,
          gridTemplateRows: `auto auto repeat(${HOURS.length}, ${CELL_HEIGHT}px)`,
        }}
      >
        {/* Угол: пусто над колонкой времени, ряд 1 (sticky-left вместе со всей колонкой времени) */}
        <div
          className="sticky left-0 z-20 border-r border-b bg-muted/30"
          style={{ gridColumn: 1, gridRow: 1 }}
        />
        {/* Заголовки дней — правая граница утолщённая, она же разделитель дней */}
        {weekDays.map((day, di) => (
          <div
            key={`day-${day}`}
            className="border-r-2 border-r-border border-b bg-muted/30 p-2 text-center text-sm font-semibold"
            style={{
              gridColumn: `${2 + di * roomsCount} / span ${roomsCount}`,
              gridRow: 1,
            }}
          >
            {dayNames[di]} {formatDateShort(day)}
          </div>
        ))}

        {/* Угол: пусто над колонкой времени, ряд 2 */}
        <div
          className="sticky left-0 z-20 border-r border-b bg-muted/20"
          style={{ gridColumn: 1, gridRow: 2 }}
        />
        {/* Заголовки кабинетов — последний в дне получает утолщённую правую границу */}
        {weekDays.flatMap((day, di) =>
          branchRooms.map((room, ri) => {
            const isDayEdge = ri === roomsCount - 1
            return (
              <div
                key={`room-${day}-${room.id}`}
                className={`${isDayEdge ? "border-r-2 border-r-border" : "border-r"} border-b bg-muted/20 px-1 py-1 text-center text-xs truncate`}
                style={{
                  gridColumn: 2 + di * roomsCount + ri,
                  gridRow: 2,
                }}
                title={room.name}
              >
                {room.name}
              </div>
            )
          })
        )}

        {/* Время — слева, sticky-left чтобы оставаться видимым при горизонтальном скролле.
            z-20 перекрывает карточки занятий (z-10), которые проезжают под колонкой при скролле. */}
        {HOURS.map((h, hi) => (
          <div
            key={`h-${h}`}
            className="sticky left-0 z-20 border-r border-b bg-background px-1 pt-1 text-right text-xs text-muted-foreground"
            style={{ gridColumn: 1, gridRow: 3 + hi }}
          >
            {String(h).padStart(2, "0")}:00
          </div>
        ))}

        {/* Колонки день × кабинет (одна на каждую пару, занимает все часы по высоте) */}
        {weekDays.flatMap((day, di) =>
          branchRooms.map((room, ri) => {
            const colIdx = 2 + di * roomsCount + ri
            const isDayEdge = ri === roomsCount - 1
            const cellLessons = lessons.filter(
              (l) => l.date === day && l.group.room.id === room.id
            )
            return (
              <div
                key={`col-${day}-${room.id}`}
                className={`relative ${isDayEdge ? "border-r-2 border-r-border" : "border-r"}`}
                style={{
                  gridColumn: colIdx,
                  gridRow: `3 / span ${HOURS.length}`,
                }}
              >
                {/* Горизонтальные линии на границах часов */}
                {HOURS.map((_, idx) => (
                  <div
                    key={`line-${idx}`}
                    className="pointer-events-none absolute inset-x-0 border-b"
                    style={{ top: (idx + 1) * CELL_HEIGHT - 1 }}
                  />
                ))}
                {/* Карточки занятий */}
                {cellLessons.map((lesson) => {
                  const [hStr, mStr] = lesson.startTime.split(":")
                  const startHour = parseInt(hStr, 10)
                  const startMin = parseInt(mStr, 10) || 0
                  if (
                    Number.isNaN(startHour) ||
                    startHour < effStart ||
                    startHour > effEnd
                  ) {
                    return null
                  }
                  const top =
                    (startHour - effStart) * CELL_HEIGHT + (startMin / 60) * CELL_HEIGHT
                  const duration = lesson.durationMinutes || 60
                  const height = Math.max(20, (duration / 60) * CELL_HEIGHT)
                  const enrolled = lesson.group._count.enrollments
                  const max = lesson.group.maxStudents
                  const occupancy = getOccupancyStyle(enrolled, max)
                  const colorClass = directionColorMap[lesson.group.directionId] || ""
                  const instructorName = [
                    lesson.instructor.lastName,
                    lesson.instructor.firstName?.[0]
                      ? lesson.instructor.firstName[0] + "."
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")
                  return (
                    <Link
                      key={lesson.id}
                      href={lesson.href || `/schedule/lessons/${lesson.id}`}
                      className="absolute left-0.5 right-0.5 z-10"
                      style={{ top, height }}
                    >
                      <Card
                        className={`flex h-full flex-col justify-start gap-0.5 overflow-hidden border p-1.5 text-[11px] leading-tight ${colorClass} ${occupancy.className} cursor-pointer hover:opacity-80`}
                        title={`${lesson.startTime} · ${occupancy.label}`}
                      >
                        <div className="flex items-center justify-between gap-1 font-medium truncate">
                          <span className="truncate">{lesson.group.name}</span>
                          {lesson.isTrial && (
                            <Badge
                              variant="outline"
                              className="h-3.5 px-1 text-[9px] border-blue-300 text-blue-700 dark:text-blue-400"
                            >
                              проб
                            </Badge>
                          )}
                        </div>
                        {height >= 36 && (
                          <div className="opacity-70 truncate">{instructorName}</div>
                        )}
                        {height >= 52 && (
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">
                              {enrolled}/{max}
                            </span>
                            {max > 0 && enrolled / max > 0.9 && (
                              <Badge variant="destructive" className="h-3.5 px-1 text-[9px]">
                                !
                              </Badge>
                            )}
                          </div>
                        )}
                      </Card>
                    </Link>
                  )
                })}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
