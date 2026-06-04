"use client"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"
import { filterEmployeesByBranch, isEmployeeAvailableInBranch } from "@/lib/employee-branch-filter"
import { formatWardName } from "@/lib/format-name"

interface WardLite {
  id: string
  firstName: string
  lastName: string | null
}

interface DirectionOption {
  id: string
  name: string
}

interface GroupOption {
  id: string
  name: string
  directionId: string
  branchId?: string
}

interface InstructorOption {
  id: string
  firstName: string | null
  lastName: string | null
  employeeBranches?: { branchId: string }[]
}

interface BranchOption {
  id: string
  name: string
}

interface RoomOption {
  id: string
  name: string
  branchId: string
}

const wardName = formatWardName

export type TrialFormPayload = {
  wardId: string
  groupId?: string
  directionId?: string
  instructorId?: string
  roomId?: string
  scheduledDate: string
  startTime?: string
  comment?: string
}

export function TrialLessonForm({
  wards,
  lockedWardId,
  lockedDirectionId,
  lockedBranchId,
  onSubmit,
  submitting,
  errorMessage,
  submitLabel = "Записать",
}: {
  wards: WardLite[]
  lockedWardId?: string
  lockedDirectionId?: string
  lockedBranchId?: string
  onSubmit: (payload: TrialFormPayload) => Promise<void> | void
  submitting?: boolean
  errorMessage?: string | null
  submitLabel?: string
}) {
  const [directions, setDirections] = useState<DirectionOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [instructorsList, setInstructorsList] = useState<InstructorOption[]>([])
  const [branchesList, setBranchesList] = useState<BranchOption[]>([])
  const [roomsList, setRoomsList] = useState<RoomOption[]>([])

  const [wardId, setWardId] = useState(lockedWardId || (wards.length === 1 ? wards[0].id : ""))
  const [directionId, setDirectionId] = useState(lockedDirectionId || "")
  const [branchId, setBranchId] = useState(lockedBranchId || "")

  // locked-значения приходят асинхронно из родителя (после fetch активных заявок).
  // useState инициализируется один раз — синхронизируем по приходу новых locked-значений.
  useEffect(() => {
    if (lockedWardId) setWardId(lockedWardId)
  }, [lockedWardId])
  useEffect(() => {
    if (lockedDirectionId) setDirectionId(lockedDirectionId)
  }, [lockedDirectionId])
  useEffect(() => {
    if (lockedBranchId) setBranchId(lockedBranchId)
  }, [lockedBranchId])
  const [kind, setKind] = useState<"group" | "individual">("group")
  const [groupId, setGroupId] = useState("")
  const [instructorId, setInstructorId] = useState("")
  const [roomId, setRoomId] = useState("")
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().slice(0, 10))
  const [startTime, setStartTime] = useState("10:00")
  const [comment, setComment] = useState("")
  const [validationError, setValidationError] = useState<string | null>(null)
  // Доступные даты для выбранной группы (реальные занятия). null = ещё не загружено
  // или режим «без группы»; [] = группа выбрана, занятий нет.
  const [groupLessonDates, setGroupLessonDates] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      try {
        const [dirRes, grpRes, empRes, branchRes, roomRes] = await Promise.all([
          fetch("/api/directions"),
          fetch("/api/groups"),
          fetch("/api/employees"),
          fetch("/api/branches"),
          fetch("/api/rooms"),
        ])
        if (cancelled) return
        if (dirRes.ok) setDirections(await dirRes.json())
        if (grpRes.ok) setGroups(await grpRes.json())
        if (empRes.ok) {
          const all = await empRes.json()
          setInstructorsList(
            all.filter((e: { role: string }) => ["instructor", "owner", "manager"].includes(e.role)),
          )
        }
        if (branchRes.ok) setBranchesList(await branchRes.json())
        if (roomRes.ok) setRoomsList(await roomRes.json())
      } catch {
        /* ignore */
      }
    }
    loadOptions()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredGroups = directionId && branchId
    ? groups.filter((g) => g.directionId === directionId && g.branchId === branchId)
    : []

  // При смене группы подгружаем её предстоящие занятия — это даёт честный
  // список доступных дат и убирает ошибку «У группы нет занятия на эту дату».
  useEffect(() => {
    if (kind !== "group" || !groupId) {
      setGroupLessonDates(null)
      return
    }
    let cancelled = false
    async function load() {
      try {
        // includePast=1 — на пробное можно записать задним числом, если ребёнок
        // фактически пришёл и его нужно отметить (баг #51).
        const res = await fetch(`/api/groups/${groupId}/lessons?includePast=1`)
        if (!res.ok) {
          setGroupLessonDates([])
          return
        }
        const lessons: { date: string }[] = await res.json()
        if (cancelled) return
        const dates = lessons.map((l) => l.date.slice(0, 10))
        setGroupLessonDates(dates)
        if (dates.length > 0 && !dates.includes(scheduledDate)) {
          setScheduledDate(dates[0])
        }
      } catch {
        setGroupLessonDates([])
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, kind])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setValidationError(null)
    if (!wardId) return setValidationError("Выберите подопечного")
    if (!directionId) return setValidationError("Выберите направление")
    if (!branchId) return setValidationError("Выберите филиал")
    if (kind === "group" && !groupId) return setValidationError("Выберите группу")
    if (kind === "individual" && !instructorId) return setValidationError("Выберите педагога")
    if (kind === "individual" && !startTime) return setValidationError("Укажите время")
    if (kind === "individual" && !roomId) return setValidationError("Выберите кабинет")
    if (!scheduledDate) return setValidationError("Укажите дату")

    const payload: TrialFormPayload = {
      wardId,
      scheduledDate,
      comment: comment.trim() || undefined,
    }
    if (kind === "group") {
      payload.groupId = groupId
    } else {
      payload.directionId = directionId
      payload.instructorId = instructorId
      payload.startTime = startTime
      payload.roomId = roomId
    }
    await onSubmit(payload)
  }

  const selectedWard = wards.find((w) => w.id === wardId)
  const selectedDirection = directions.find((d) => d.id === directionId)
  const selectedGroup = filteredGroups.find((g) => g.id === groupId)
  const error = errorMessage || validationError

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <div className="space-y-1.5">
        <Label>Подопечный *</Label>
        <Select
          value={wardId}
          onValueChange={(v) => {
            if (v) setWardId(v)
          }}
          disabled={!!lockedWardId}
        >
          <SelectTrigger className="w-full">
            {selectedWard ? wardName(selectedWard) : <span className="text-muted-foreground">Выберите подопечного</span>}
          </SelectTrigger>
          <SelectContent>
            {wards.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {wardName(w)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Филиал *</Label>
        <Select
          value={branchId}
          onValueChange={(v) => {
            if (v) {
              setBranchId(v)
              setGroupId("")
              setRoomId("")
            }
          }}
        >
          <SelectTrigger className="w-full">
            {branchId ? (
              branchesList.find((b) => b.id === branchId)?.name
            ) : (
              <span className="text-muted-foreground">Выберите филиал</span>
            )}
          </SelectTrigger>
          <SelectContent>
            {branchesList.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Направление *</Label>
        <Select
          value={directionId}
          onValueChange={(v) => {
            if (v) {
              setDirectionId(v)
              setGroupId("")
            }
          }}
        >
          <SelectTrigger className="w-full">
            {selectedDirection ? selectedDirection.name : <span className="text-muted-foreground">Выберите направление</span>}
          </SelectTrigger>
          <SelectContent>
            {directions.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Тип пробного</Label>
        <div className="inline-flex rounded-md border p-0.5">
          <button
            type="button"
            onClick={() => setKind("group")}
            className={`px-3 py-1 text-xs rounded-sm transition-colors ${
              kind === "group" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            В группе
          </button>
          <button
            type="button"
            onClick={() => setKind("individual")}
            className={`px-3 py-1 text-xs rounded-sm transition-colors ${
              kind === "individual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Персональный
          </button>
        </div>
      </div>

      {kind === "group" && (
        <div className="space-y-1.5">
          <Label>Группа *</Label>
          <Select
            value={groupId}
            onValueChange={(v) => {
              if (v) setGroupId(v)
            }}
            disabled={!directionId || !branchId}
          >
            <SelectTrigger className="w-full">
              {selectedGroup ? (
                selectedGroup.name
              ) : (
                <span className="text-muted-foreground">
                  {!directionId
                    ? "Сначала выберите направление"
                    : !branchId
                      ? "Сначала выберите филиал"
                      : filteredGroups.length === 0
                        ? "Нет групп в этом филиале"
                        : "Выберите группу"}
                </span>
              )}
            </SelectTrigger>
            <SelectContent>
              {filteredGroups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {kind === "individual" && (
        <>
          <div className="space-y-1.5">
            <Label>Педагог *</Label>
            <Select value={instructorId} onValueChange={(v) => v && setInstructorId(v)}>
              <SelectTrigger className="w-full">
                {(() => {
                  const sel = instructorsList.find((e) => e.id === instructorId)
                  if (!sel) return <span className="text-muted-foreground">Выберите педагога</span>
                  return [sel.lastName, sel.firstName].filter(Boolean).join(" ") || "Без имени"
                })()}
              </SelectTrigger>
              <SelectContent>
                {(() => {
                  const filtered = filterEmployeesByBranch(instructorsList, branchId || null)
                  const selected = instructorsList.find((x) => x.id === instructorId)
                  const showOutOfBranch = selected && !isEmployeeAvailableInBranch(selected, branchId || null)
                  const visible = showOutOfBranch
                    ? [selected!, ...filtered.filter((x) => x.id !== selected!.id)]
                    : filtered
                  return visible.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {[e.lastName, e.firstName].filter(Boolean).join(" ") || "Без имени"}
                    </SelectItem>
                  ))
                })()}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Кабинет *</Label>
            <Select value={roomId} onValueChange={(v) => v && setRoomId(v)} disabled={!branchId}>
              <SelectTrigger className="w-full">
                {roomId ? (
                  roomsList.find((r) => r.id === roomId)?.name
                ) : (
                  <span className="text-muted-foreground">
                    {branchId ? "Выберите кабинет" : "Сначала выберите филиал"}
                  </span>
                )}
              </SelectTrigger>
              <SelectContent>
                {roomsList
                  .filter((r) => r.branchId === branchId)
                  .map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className={kind === "individual" ? "space-y-1.5" : "col-span-2 space-y-1.5"}>
          <Label>Дата *</Label>
          {kind === "group" && groupId ? (
            <Calendar
              value={scheduledDate}
              onChange={setScheduledDate}
              availableDates={groupLessonDates ? new Set(groupLessonDates) : undefined}
              emptyHint="Сначала сгенерируйте расписание для этой группы."
            />
          ) : (
            <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
          )}
        </div>
        {kind === "individual" && (
          <div className="space-y-1.5">
            <Label>Время *</Label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Комментарий</Label>
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {submitting ? "Сохранение..." : submitLabel}
      </button>
    </form>
  )
}
