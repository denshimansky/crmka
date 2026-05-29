"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { CalendarDays, X, Filter, Baby } from "lucide-react"
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

interface WardOption {
  id: string
  firstName: string
  lastName: string | null
  parentName: string
}

interface ScheduleFiltersProps {
  lessons: LessonData[]
  rooms: Room[]
  allRooms: RoomWithBranch[]
  branches: Branch[]
  directions: Direction[]
  instructors: Instructor[]
  wards: WardOption[]
  currentWardId: string | null
  weekDays: string[] // ISO date strings
  dayNames: string[]
  directionColorMap: Record<string, string>
  view: ScheduleView
  // Объединённый диапазон часов работы филиалов (для вида «По неделе»)
  weekHourStart: number
  weekHourEnd: number
}

function wardLabel(w: WardOption): string {
  const own = [w.lastName, w.firstName].filter(Boolean).join(" ") || "Без имени"
  return `${own} · ${w.parentName}`
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
  wards,
  currentWardId,
  weekDays,
  dayNames,
  directionColorMap,
  view,
  weekHourStart,
  weekHourEnd,
}: ScheduleFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [roomFilter, setRoomFilter] = useState<string>("")
  const [directionFilter, setDirectionFilter] = useState<string>("")
  const [instructorFilter, setInstructorFilter] = useState<string>("")
  const [branchFilter, setBranchFilter] = useState<string>(() => branches[0]?.id || "")
  const [wardSearch, setWardSearch] = useState<string>("")

  const hasFilters = !!(roomFilter || directionFilter || instructorFilter || currentWardId)

  function setWardFilter(id: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (id) params.set("wardId", id)
    else params.delete("wardId")
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const selectedWard = wards.find((w) => w.id === currentWardId) || null
  const filteredWards = useMemo(() => {
    const q = wardSearch.trim().toLowerCase()
    if (!q) return wards.slice(0, 100)
    return wards
      .filter((w) => {
        const own = [w.lastName, w.firstName].filter(Boolean).join(" ").toLowerCase()
        return own.includes(q) || w.parentName.toLowerCase().includes(q)
      })
      .slice(0, 100)
  }, [wards, wardSearch])

  const filteredLessons = useMemo(() => {
    return lessons.filter((l) => {
      if (roomFilter && l.group.room.id !== roomFilter) return false
      if (directionFilter && l.group.directionId !== directionFilter) return false
      if (instructorFilter && l.instructorId !== instructorFilter) return false
      return true
    })
  }, [lessons, roomFilter, directionFilter, instructorFilter])

  type Row = { id: string; label: string }

  const visibleRows: Row[] = useMemo(() => {
    const ids = new Set(filteredLessons.map((l) => l.group.room.id))
    return rooms.filter((r) => ids.has(r.id)).map((r) => ({ id: r.id, label: r.name }))
  }, [filteredLessons, rooms])

  function clearFilters() {
    setRoomFilter("")
    setDirectionFilter("")
    setInstructorFilter("")
    if (currentWardId) setWardFilter(null)
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
  if (selectedWard) {
    activeFilterLabels.push({
      label: `Ребёнок: ${wardLabel(selectedWard)}`,
      onClear: () => setWardFilter(null),
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

        <Select
          value={currentWardId ?? ""}
          onValueChange={(v) => setWardFilter(v || null)}
        >
          <SelectTrigger className="w-[260px]">
            {selectedWard ? (
              <span className="flex items-center gap-1.5">
                <Baby className="size-3.5" />
                {wardLabel(selectedWard)}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Baby className="size-3.5" />
                Ребёнок
              </span>
            )}
          </SelectTrigger>
          <SelectContent>
            <div className="sticky top-0 z-10 -mx-1 mb-1 border-b bg-popover p-1">
              <input
                value={wardSearch}
                onChange={(e) => setWardSearch(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                placeholder="Поиск по ФИО ребёнка или родителя..."
                className="h-8 w-full rounded-sm border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {selectedWard && !filteredWards.some((w) => w.id === selectedWard.id) && (
              <SelectItem value={selectedWard.id}>{wardLabel(selectedWard)}</SelectItem>
            )}
            {filteredWards.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                Не найдено
              </div>
            ) : (
              filteredWards.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {wardLabel(w)}
                </SelectItem>
              ))
            )}
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
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div
              className="grid gap-px bg-border"
              style={{ gridTemplateColumns: `160px repeat(7, 1fr)` }}
            >
              {/* Header */}
              <div className="bg-background p-2 text-xs font-medium text-muted-foreground">
                Кабинет
              </div>
              {weekDays.map((day, i) => (
                <div key={i} className="bg-background p-2 text-center text-sm font-medium">
                  {dayNames[i]} {formatDateShort(day)}
                </div>
              ))}

              {/* Rows by room */}
              {visibleRows.map((row) => (
                <div key={row.id} className="contents">
                  <div className="bg-background p-2 text-sm font-medium text-muted-foreground">
                    {row.label}
                  </div>
                  {weekDays.map((dayStr, di) => {
                    const dayLessons = filteredLessons.filter(
                      (l) => l.group.room.id === row.id && l.date === dayStr
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
                                <div className="opacity-70">{instructorName}</div>
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
// Колонка времени физически вынесена в отдельный flex-блок слева — не зависит
// от horizontal scroll правой сетки, поэтому никогда не уезжает.
// Карточка занятия позиционируется абсолютно внутри столбца «день-кабинет»:
//   top    = (часы от hourStart) * CELL_HEIGHT + (минуты начала / 60) * CELL_HEIGHT
//   height = (длительность / 60) * CELL_HEIGHT  (45 мин = 3/4 ячейки, 30 мин = 1/2)
const CELL_HEIGHT = 64
const HEADER_DAY_H = 36
const HEADER_ROOM_H = 28

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
    <div className="flex border-l border-t bg-background">
      {/* Левая фиксированная колонка времени — физически вне горизонтального скролла. */}
      <div className="flex-none border-r" style={{ width: 60 }}>
        <div className="border-b bg-muted/30" style={{ height: HEADER_DAY_H }} />
        <div className="border-b bg-muted/20" style={{ height: HEADER_ROOM_H }} />
        {HOURS.map((h) => (
          <div
            key={`h-${h}`}
            className="border-b bg-background px-1 pt-1 text-right text-xs text-muted-foreground"
            style={{ height: CELL_HEIGHT }}
          >
            {String(h).padStart(2, "0")}:00
          </div>
        ))}
      </div>

      {/* Правая прокручиваемая сетка: дни × кабинеты с карточками занятий. */}
      <div className="flex-1 overflow-x-auto">
        <div
          className="grid bg-background"
          style={{
            gridTemplateColumns: `repeat(${colCount}, minmax(120px, 1fr))`,
            gridTemplateRows: `${HEADER_DAY_H}px ${HEADER_ROOM_H}px repeat(${HOURS.length}, ${CELL_HEIGHT}px)`,
          }}
        >
          {/* Заголовки дней — правая граница утолщённая, она же разделитель дней */}
          {weekDays.map((day, di) => (
            <div
              key={`day-${day}`}
              className="border-r-2 border-r-border border-b bg-muted/30 p-2 text-center text-sm font-semibold"
              style={{
                gridColumn: `${1 + di * roomsCount} / span ${roomsCount}`,
                gridRow: 1,
              }}
            >
              {dayNames[di]} {formatDateShort(day)}
            </div>
          ))}

          {/* Заголовки кабинетов — последний в дне получает утолщённую правую границу */}
          {weekDays.flatMap((day, di) =>
            branchRooms.map((room, ri) => {
              const isDayEdge = ri === roomsCount - 1
              return (
                <div
                  key={`room-${day}-${room.id}`}
                  className={`${isDayEdge ? "border-r-2 border-r-border" : "border-r"} border-b bg-muted/20 px-1 py-1 text-center text-xs truncate`}
                  style={{
                    gridColumn: 1 + di * roomsCount + ri,
                    gridRow: 2,
                  }}
                  title={room.name}
                >
                  {room.name}
                </div>
              )
            })
          )}

          {/* Колонки день × кабинет (одна на каждую пару, занимает все часы по высоте) */}
          {weekDays.flatMap((day, di) =>
            branchRooms.map((room, ri) => {
              const colIdx = 1 + di * roomsCount + ri
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
    </div>
  )
}
