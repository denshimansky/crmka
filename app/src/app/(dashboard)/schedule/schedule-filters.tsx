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
  SelectValue,
} from "@/components/ui/select"
import { CalendarDays, X, Filter } from "lucide-react"

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
  instructorId: string
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

interface ScheduleFiltersProps {
  lessons: LessonData[]
  rooms: Room[]
  directions: Direction[]
  instructors: Instructor[]
  weekDays: string[] // ISO date strings
  dayNames: string[]
  directionColorMap: Record<string, string>
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
  directions,
  instructors,
  weekDays,
  dayNames,
  directionColorMap,
}: ScheduleFiltersProps) {
  const [roomFilter, setRoomFilter] = useState<string>("")
  const [directionFilter, setDirectionFilter] = useState<string>("")
  const [instructorFilter, setInstructorFilter] = useState<string>("")

  const hasFilters = !!(roomFilter || directionFilter || instructorFilter)

  const filteredLessons = useMemo(() => {
    return lessons.filter((l) => {
      if (roomFilter && l.group.room.id !== roomFilter) return false
      if (directionFilter && l.group.directionId !== directionFilter) return false
      if (instructorFilter && l.instructorId !== instructorFilter) return false
      return true
    })
  }, [lessons, roomFilter, directionFilter, instructorFilter])

  // Rooms that have lessons after filtering (for grid rows)
  const visibleRooms = useMemo(() => {
    const ids = new Set(filteredLessons.map((l) => l.group.room.id))
    return rooms.filter((r) => ids.has(r.id))
  }, [filteredLessons, rooms])

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
        <Select value={roomFilter} onValueChange={(v) => setRoomFilter(v ?? "")}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Кабинет" />
          </SelectTrigger>
          <SelectContent>
            {rooms.map((room) => (
              <SelectItem key={room.id} value={room.id}>
                {room.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={directionFilter} onValueChange={(v) => setDirectionFilter(v ?? "")}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Направление" />
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
            <SelectValue placeholder="Педагог" />
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
      {filteredLessons.length === 0 ? (
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
              style={{ gridTemplateColumns: `120px repeat(7, 1fr)` }}
            >
              {/* Header */}
              <div className="bg-background p-2" />
              {weekDays.map((day, i) => (
                <div key={i} className="bg-background p-2 text-center text-sm font-medium">
                  {dayNames[i]} {formatDateShort(day)}
                </div>
              ))}

              {/* Rows by room */}
              {visibleRooms.map((room) => (
                <>
                  <div
                    key={room.id}
                    className="bg-background p-2 text-sm font-medium text-muted-foreground"
                  >
                    {room.name}
                  </div>
                  {weekDays.map((dayStr, di) => {
                    const dayLessons = filteredLessons.filter(
                      (l) => l.group.room.id === room.id && l.date === dayStr
                    )
                    return (
                      <div
                        key={`${room.id}-${di}`}
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
                            lesson.instructor.firstName?.[0] + ".",
                          ]
                            .filter(Boolean)
                            .join(" ")
                          return (
                            <Link key={lesson.id} href={`/schedule/lessons/${lesson.id}`}>
                              <Card
                                className={`cursor-pointer border p-2 text-xs ${colorClass} ${occupancy.className} hover:opacity-80`}
                                title={occupancy.label}
                              >
                                <div className="font-bold">{lesson.startTime}</div>
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
                </>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
