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
import { X, Filter, Baby } from "lucide-react"
import { ClientCombobox } from "@/components/client-combobox"
import { StickyHScroll } from "@/components/sticky-h-scroll"
import type { ScheduleView } from "./schedule-week-nav"
import { BRANCH_ALL_VALUE, useBranchFilter } from "@/hooks/use-branch-filter"
import { useRoleNames } from "@/components/role-names-provider"
import { MonthCalendarView } from "./month-calendar-view"
import { TrialDetailsDialog, type TrialCardInfo } from "./trial-details-dialog"

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
  isTrial?: boolean
  /** Индивидуальное пробное: клик открывает диалог деталей вместо карточки занятия. */
  trial?: TrialCardInfo
  /** На занятии назначена замена — instructor содержит замещающего инструктора. */
  isSubstitute?: boolean
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
  allRooms: RoomWithBranch[]
  branches: Branch[]
  directions: Direction[]
  instructors: Instructor[]
  currentWardId: string | null
  /** Подпись выбранного ребёнка («Фамилия Имя · Родитель») — список детей
   *  целиком на клиент больше не выгружается, поиск идёт через API. */
  currentWardName: string | null
  weekDays: string[] // ISO date strings
  dayNames: string[]
  gridDays: { date: string; inCurrentMonth: boolean }[]
  directionColorMap: Record<string, string>
  view: ScheduleView
  // Объединённый диапазон часов работы филиалов (для вида «По неделе»)
  weekHourStart: number
  weekHourEnd: number
  /** Роль позволяет переносить пробные из диалога (owner/manager/admin). */
  canRescheduleTrials: boolean
  canMarkTrials: boolean
}

function getOccupancyStyle(enrolled: number, max: number): { className: string; label: string } {
  if (max === 0) return { className: "border-l-4 border-l-gray-400", label: "—" }
  // Превышение лимита (больше учеников, чем мест) — отдельное состояние «переполнена»
  // с восклицательным знаком на карточке. Полностью занятая группа (ровно по лимиту)
  // ещё НЕ переполнена — предупреждения нет.
  if (enrolled > max) {
    return { className: "border-l-4 border-l-red-500", label: "переполнена" }
  }
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
  allRooms,
  branches,
  directions,
  instructors,
  currentWardId,
  currentWardName,
  weekDays,
  dayNames,
  gridDays,
  directionColorMap,
  view,
  weekHourStart,
  weekHourEnd,
  canRescheduleTrials,
  canMarkTrials,
}: ScheduleFiltersProps) {
  const roleNames = useRoleNames()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [roomFilter, setRoomFilter] = useState<string>("")
  const [directionFilter, setDirectionFilter] = useState<string>("")
  const [instructorFilter, setInstructorFilter] = useState<string>("")
  const { branchId: branchFilter, setBranchId: setBranchFilter } = useBranchFilter({
    branches,
    allowAll: view === "week",
    defaultBranchId: branches[0]?.id ?? "",
  })

  const hasFilters = !!(roomFilter || directionFilter || instructorFilter || currentWardId)

  // Список кабинетов для фильтра: если выбран филиал — только его кабинеты,
  // иначе все. Источник — allRooms (с branchId), а не rooms (только из текущих
  // занятий), чтобы пользователь мог выбрать кабинет даже без занятий в нём.
  const availableRoomsForFilter = useMemo(() => {
    if (branchFilter && branchFilter !== BRANCH_ALL_VALUE) {
      return allRooms.filter((r) => r.branchId === branchFilter)
    }
    return allRooms
  }, [allRooms, branchFilter])

  function setWardFilter(id: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (id) params.set("wardId", id)
    else params.delete("wardId")
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  // В месячном виде сетки кабинетов нет — фильтрация по филиалу должна работать
  // явно через сами занятия (lesson → room → branch). В неделе это делает
  // WeekRoomsView (выбирает кабинеты по branchId), но если выбран конкретный
  // кабинет, лента занятий должна по нему фильтроваться независимо от вида.
  const branchRoomIds = useMemo(() => {
    if (view !== "month") return null
    if (!branchFilter || branchFilter === BRANCH_ALL_VALUE) return null
    return new Set(allRooms.filter((r) => r.branchId === branchFilter).map((r) => r.id))
  }, [view, branchFilter, allRooms])

  const filteredLessons = useMemo(() => {
    return lessons.filter((l) => {
      if (roomFilter && l.group.room.id !== roomFilter) return false
      if (directionFilter && l.group.directionId !== directionFilter) return false
      if (instructorFilter && l.instructorId !== instructorFilter) return false
      if (branchRoomIds && !branchRoomIds.has(l.group.room.id)) return false
      return true
    })
  }, [lessons, roomFilter, directionFilter, instructorFilter, branchRoomIds])

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
    const room = allRooms.find((r) => r.id === roomFilter)
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
      label: `${roleNames.instructor}: ${instr ? `${instr.lastName} ${instr.firstName?.[0] || ""}.` : "?"}`,
      onClear: () => setInstructorFilter(""),
    })
  }
  if (currentWardId) {
    activeFilterLabels.push({
      label: `Ребёнок: ${currentWardName || "выбран"}`,
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
              {branchFilter === BRANCH_ALL_VALUE ? (
                "Все филиалы"
              ) : branchFilter ? (
                branches.find((b) => b.id === branchFilter)?.name || "Филиал"
              ) : (
                <span className="text-muted-foreground">Филиал</span>
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BRANCH_ALL_VALUE}>Все филиалы</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Select
            value={branchFilter === BRANCH_ALL_VALUE ? "" : branchFilter}
            onValueChange={(v) => {
              if (v) setBranchFilter(v)
            }}
          >
            <SelectTrigger className="w-[220px]">
              {branchFilter && branchFilter !== BRANCH_ALL_VALUE ? (
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
        )}

        <Select value={roomFilter} onValueChange={(v) => setRoomFilter(v ?? "")}>
          <SelectTrigger className="w-[180px]">
            {roomFilter ? (
              allRooms.find((r) => r.id === roomFilter)?.name || "Кабинет"
            ) : (
              <span className="text-muted-foreground">Кабинет</span>
            )}
          </SelectTrigger>
          <SelectContent>
            {availableRoomsForFilter.map((room) => (
              <SelectItem key={room.id} value={room.id}>
                {room.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
              if (!instr) return <span className="text-muted-foreground">{roleNames.instructor}</span>
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

        {/* Фильтр по ребёнку — комбобокс с серверным поиском, а не Select со
            встроенным полем: список детей в браузер целиком не грузится (иначе
            обрезался хвост алфавита), выпадашка привязана к полю и не «уезжает»
            при вводе, а длинное ФИО обрезается внутри поля, а не наезжает на
            соседние элементы. */}
        <ClientCombobox
          className="w-[260px]"
          value={currentWardId ?? ""}
          onChange={(id) => setWardFilter(id || null)}
          placeholder="Ребёнок"
          icon={<Baby />}
          serverSearch={{ url: "/api/wards/search" }}
          initialOption={
            currentWardId
              ? { id: currentWardId, name: currentWardName || "Выбранный ребёнок" }
              : null
          }
        />

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
              className="max-w-full cursor-pointer gap-1 pr-1"
              onClick={f.onClear}
              title={f.label}
            >
              {/* Длинное ФИО (ребёнок + родитель) обрезаем внутри плашки, иначе
                  она вылезает за строку фильтров. */}
              <span className="min-w-0 truncate">{f.label}</span>
              <X className="size-3 shrink-0" />
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
          roomFilter={roomFilter}
          weekDays={weekDays}
          dayNames={dayNames}
          directionColorMap={directionColorMap}
          formatDateShort={formatDateShort}
          hourStart={weekHourStart}
          hourEnd={weekHourEnd}
          canRescheduleTrials={canRescheduleTrials}
          canMarkTrials={canMarkTrials}
        />
      ) : (
        <MonthCalendarView
          lessons={filteredLessons}
          gridDays={gridDays}
          weekdayNames={dayNames}
          directionColorMap={directionColorMap}
          todayKey={new Date().toISOString().slice(0, 10)}
          canRescheduleTrials={canRescheduleTrials}
          canMarkTrials={canMarkTrials}
        />
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
const HEADER_BRANCH_H = 26
const HEADER_ROOM_H = 28

interface WeekRoomsViewProps {
  lessons: LessonData[]
  allRooms: RoomWithBranch[]
  branches: Branch[]
  branchId: string
  roomFilter: string
  weekDays: string[]
  dayNames: string[]
  directionColorMap: Record<string, string>
  formatDateShort: (dateStr: string) => string
  hourStart: number
  hourEnd: number
  canRescheduleTrials: boolean
  canMarkTrials: boolean
}

function WeekRoomsView({
  lessons,
  allRooms,
  branches,
  branchId,
  roomFilter,
  weekDays,
  dayNames,
  directionColorMap,
  formatDateShort,
  hourStart,
  hourEnd,
  canRescheduleTrials,
  canMarkTrials,
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

  // Группируем кабинеты по филиалам. При «Все филиалы» — берём все филиалы
  // с кабинетами; иначе — один выбранный филиал. Если в фильтре выбран
  // конкретный кабинет — оставляем только его, остальные колонки скрываются.
  const isAllBranches = branchId === "all"
  const branchGroupsRaw: { branch: Branch; rooms: RoomWithBranch[] }[] = isAllBranches
    ? branches
        .map((b) => ({
          branch: b,
          rooms: allRooms.filter((r) => r.branchId === b.id),
        }))
        .filter((g) => g.rooms.length > 0)
    : (() => {
        const b = branches.find((x) => x.id === branchId)
        if (!b) return []
        const rs = allRooms.filter((r) => r.branchId === b.id)
        return rs.length ? [{ branch: b, rooms: rs }] : []
      })()

  const branchGroups = roomFilter
    ? branchGroupsRaw
        .map((g) => ({ ...g, rooms: g.rooms.filter((r) => r.id === roomFilter) }))
        .filter((g) => g.rooms.length > 0)
    : branchGroupsRaw

  const visibleRooms: RoomWithBranch[] = branchGroups.flatMap((g) => g.rooms)
  const roomsPerDay = visibleRooms.length

  if (roomsPerDay === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {isAllBranches
          ? "Нет кабинетов ни в одном филиале. Добавьте кабинеты в настройках."
          : "В филиале нет кабинетов. Добавьте кабинеты в настройках филиала."}
      </div>
    )
  }

  const colCount = weekDays.length * roomsPerDay
  const showBranchRow = isAllBranches
  const roomHeaderRow = showBranchRow ? 3 : 2
  const bodyStartRow = showBranchRow ? 4 : 3
  const headerRowsTemplate = showBranchRow
    ? `${HEADER_DAY_H}px ${HEADER_BRANCH_H}px ${HEADER_ROOM_H}px`
    : `${HEADER_DAY_H}px ${HEADER_ROOM_H}px`

  return (
    <StickyHScroll>
    <div className="flex border-l border-t bg-background">
      {/* Левая фиксированная колонка времени — физически вне горизонтального скролла. */}
      <div className="flex-none border-r" style={{ width: 60 }}>
        <div className="border-b bg-muted/30" style={{ height: HEADER_DAY_H }} />
        {showBranchRow && (
          <div className="border-b bg-muted/20" style={{ height: HEADER_BRANCH_H }} />
        )}
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
      <div className="flex-1 overflow-x-auto" data-sticky-scroller="">
        <div
          className="grid bg-background"
          style={{
            gridTemplateColumns: `repeat(${colCount}, minmax(120px, 1fr))`,
            gridTemplateRows: `${headerRowsTemplate} repeat(${HOURS.length}, ${CELL_HEIGHT}px)`,
          }}
        >
          {/* Заголовки дней — правая граница утолщённая, она же разделитель дней */}
          {weekDays.map((day, di) => (
            <div
              key={`day-${day}`}
              className="border-r-2 border-r-border border-b bg-muted/30 p-2 text-center text-sm font-semibold"
              style={{
                gridColumn: `${1 + di * roomsPerDay} / span ${roomsPerDay}`,
                gridRow: 1,
              }}
            >
              {dayNames[di]} {formatDateShort(day)}
            </div>
          ))}

          {/* Заголовки филиалов (только при «Все филиалы») */}
          {showBranchRow &&
            weekDays.flatMap((day, di) => {
              let branchOffset = 0
              return branchGroups.map((g, gi) => {
                const isLastBranchInDay = gi === branchGroups.length - 1
                const startCol = 1 + di * roomsPerDay + branchOffset
                const el = (
                  <div
                    key={`branch-${day}-${g.branch.id}`}
                    className={`${isLastBranchInDay ? "border-r-2 border-r-border" : "border-r"} border-b bg-muted/30 px-1 py-1 text-center text-xs font-semibold truncate`}
                    style={{
                      gridColumn: `${startCol} / span ${g.rooms.length}`,
                      gridRow: 2,
                    }}
                    title={g.branch.name}
                  >
                    {g.branch.name}
                  </div>
                )
                branchOffset += g.rooms.length
                return el
              })
            })}

          {/* Заголовки кабинетов */}
          {weekDays.flatMap((day, di) => {
            let dayRoomIdx = 0
            return branchGroups.flatMap((g, gi) =>
              g.rooms.map((room, ri) => {
                const isBranchEdge = ri === g.rooms.length - 1
                const isLastBranchInDay = gi === branchGroups.length - 1
                const isDayEdge = isBranchEdge && isLastBranchInDay
                const thickRight = isDayEdge || (isBranchEdge && showBranchRow)
                const colIdx = 1 + di * roomsPerDay + dayRoomIdx
                dayRoomIdx += 1
                return (
                  <div
                    key={`room-${day}-${room.id}`}
                    className={`${thickRight ? "border-r-2 border-r-border" : "border-r"} border-b bg-muted/20 px-1 py-1 text-center text-xs truncate`}
                    style={{
                      gridColumn: colIdx,
                      gridRow: roomHeaderRow,
                    }}
                    title={room.name}
                  >
                    {room.name}
                  </div>
                )
              })
            )
          })}

          {/* Колонки день × кабинет (одна на каждую пару, занимает все часы по высоте) */}
          {weekDays.flatMap((day, di) => {
            let dayRoomIdx = 0
            return branchGroups.flatMap((g, gi) =>
              g.rooms.map((room, ri) => {
                const isBranchEdge = ri === g.rooms.length - 1
                const isLastBranchInDay = gi === branchGroups.length - 1
                const isDayEdge = isBranchEdge && isLastBranchInDay
                const thickRight = isDayEdge || (isBranchEdge && showBranchRow)
                const colIdx = 1 + di * roomsPerDay + dayRoomIdx
                dayRoomIdx += 1
                const cellLessons = lessons.filter(
                  (l) => l.date === day && l.group.room.id === room.id
                )
                return (
                <div
                  key={`col-${day}-${room.id}`}
                  className={`relative ${thickRight ? "border-r-2 border-r-border" : "border-r"}`}
                  style={{
                    gridColumn: colIdx,
                    gridRow: `${bodyStartRow} / span ${HOURS.length}`,
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
                  const instructorLabel = lesson.isSubstitute
                    ? `${instructorName} (зам.)`
                    : instructorName
                  const card = (
                    <Card
                      className={`flex h-full flex-col justify-start gap-0.5 overflow-hidden border p-1.5 text-[11px] leading-tight ${colorClass} ${occupancy.className} cursor-pointer hover:opacity-80`}
                      title={`${lesson.startTime} · ${occupancy.label}`}
                    >
                      <div className="flex items-center justify-between gap-1 font-medium truncate">
                        <span className="truncate">{lesson.group.name}</span>
                        {lesson.isTrial && (
                          <Badge
                            variant="outline"
                            className={`h-3.5 px-1 text-[9px] ${
                              lesson.trial?.status === "attended"
                                ? "border-green-300 text-green-700 dark:text-green-400"
                                : lesson.trial?.status === "no_show"
                                  ? "border-red-300 text-red-700 dark:text-red-400"
                                  : "border-blue-300 text-blue-700 dark:text-blue-400"
                            }`}
                          >
                            {lesson.trial?.status === "attended"
                              ? "был"
                              : lesson.trial?.status === "no_show"
                                ? "н/п"
                                : "проб"}
                          </Badge>
                        )}
                      </div>
                      {height >= 36 && (
                        <div
                          className={`truncate ${
                            lesson.isSubstitute
                              ? "font-medium text-orange-700 dark:text-orange-300"
                              : "opacity-70"
                          }`}
                          title={lesson.isSubstitute ? "Замена" : undefined}
                        >
                          {instructorLabel}
                        </div>
                      )}
                      {height >= 52 && (
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">
                            {enrolled}/{max}
                          </span>
                          {max > 0 && enrolled > max && (
                            <Badge
                              variant="destructive"
                              className="h-3.5 px-1 text-[9px]"
                              title="Превышен лимит группы"
                            >
                              !
                            </Badge>
                          )}
                        </div>
                      )}
                    </Card>
                  )
                  // Индивидуальное пробное: диалог деталей с переносом
                  // (сущности занятия у него нет — открывать нечего).
                  return lesson.trial ? (
                    <TrialDetailsDialog
                      key={lesson.id}
                      trial={lesson.trial}
                      canReschedule={canRescheduleTrials}
                      canMark={canMarkTrials}
                      triggerClassName="absolute left-0.5 right-0.5 z-10 block"
                      triggerStyle={{ top, height }}
                    >
                      {card}
                    </TrialDetailsDialog>
                  ) : (
                    <Link
                      key={lesson.id}
                      href={`/schedule/lessons/${lesson.id}`}
                      className="absolute left-0.5 right-0.5 z-10"
                      style={{ top, height }}
                    >
                      {card}
                    </Link>
                  )
                })}
              </div>
                )
              })
            )
          })}
        </div>
      </div>
    </div>
    </StickyHScroll>
  )
}
