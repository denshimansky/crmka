"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { CalendarPlus } from "lucide-react"

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "new", label: "Новый" },
  { value: "trial_scheduled", label: "Пробное записано" },
  { value: "trial_attended", label: "Пробное пройдено" },
  { value: "awaiting_payment", label: "Ожидание оплаты" },
  { value: "potential", label: "Потенциальный" },
  { value: "non_target", label: "Не целевой" },
  { value: "blacklisted", label: "Чёрный список" },
  { value: "archived", label: "Архив" },
]

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
}

interface InstructorOption {
  id: string
  firstName: string | null
  lastName: string | null
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

function wardName(w: WardLite): string {
  return [w.firstName, w.lastName].filter(Boolean).join(" ") || "Без имени"
}

export function LeadStatusActions({
  clientId,
  currentStatus,
  wards,
}: {
  clientId: string
  currentStatus: string
  wards: WardLite[]
}) {
  const router = useRouter()
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusValue, setStatusValue] = useState(currentStatus)

  // Когда родитель перерисовался после router.refresh() — синхронизируем
  useEffect(() => {
    setStatusValue(currentStatus)
  }, [currentStatus])

  // ----- Trial dialog state -----
  const [trialOpen, setTrialOpen] = useState(false)
  const [trialLoading, setTrialLoading] = useState(false)
  const [trialError, setTrialError] = useState<string | null>(null)
  const [directions, setDirections] = useState<DirectionOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [instructorsList, setInstructorsList] = useState<InstructorOption[]>([])
  const [instructorId, setInstructorId] = useState("")
  const [branchesList, setBranchesList] = useState<BranchOption[]>([])
  const [roomsList, setRoomsList] = useState<RoomOption[]>([])
  const [branchId, setBranchId] = useState("")
  const [roomId, setRoomId] = useState("")

  const [wardId, setWardId] = useState("")
  const [directionId, setDirectionId] = useState("")
  const [kind, setKind] = useState<"group" | "individual">("group")
  const [groupId, setGroupId] = useState("")
  const [scheduledDate, setScheduledDate] = useState(
    new Date().toISOString().slice(0, 10)
  )
  const [startTime, setStartTime] = useState("10:00")
  const [comment, setComment] = useState("")

  async function handleStatusChange(value: string | null) {
    if (!value || value === statusValue) return
    setStatusValue(value)
    setStatusLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funnelStatus: value }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        setStatusValue(currentStatus)
      }
    } catch {
      setStatusValue(currentStatus)
    } finally {
      setStatusLoading(false)
    }
  }

  async function loadTrialOptions() {
    setTrialError(null)
    setKind("group")
    setWardId(wards.length === 1 ? wards[0].id : "")
    setDirectionId("")
    setGroupId("")
    setInstructorId("")
    setBranchId("")
    setRoomId("")
    setScheduledDate(new Date().toISOString().slice(0, 10))
    setStartTime("10:00")
    setComment("")
    try {
      const [dirRes, grpRes, empRes, branchRes, roomRes] = await Promise.all([
        fetch("/api/directions"),
        fetch("/api/groups"),
        fetch("/api/employees"),
        fetch("/api/branches"),
        fetch("/api/rooms"),
      ])
      if (dirRes.ok) setDirections(await dirRes.json())
      if (grpRes.ok) setGroups(await grpRes.json())
      if (empRes.ok) {
        const all = await empRes.json()
        // Только те, кто может вести занятие — инструкторы / владелец / управляющий
        setInstructorsList(
          all.filter((e: { role: string }) =>
            ["instructor", "owner", "manager"].includes(e.role)
          )
        )
      }
      if (branchRes.ok) setBranchesList(await branchRes.json())
      if (roomRes.ok) setRoomsList(await roomRes.json())
    } catch {
      /* ignore */
    }
  }

  async function handleTrialSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTrialError(null)
    if (!wardId) {
      setTrialError("Выберите подопечного")
      return
    }
    if (!directionId) {
      setTrialError("Выберите направление")
      return
    }
    if (kind === "group" && !groupId) {
      setTrialError("Выберите группу или переключитесь на «Индивидуальный»")
      return
    }
    if (kind === "individual" && !instructorId) {
      setTrialError("Выберите педагога")
      return
    }
    if (kind === "individual" && !startTime) {
      setTrialError("Укажите время")
      return
    }
    if (!scheduledDate) {
      setTrialError("Укажите дату")
      return
    }

    setTrialLoading(true)
    try {
      const payload: Record<string, unknown> = {
        clientId,
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
        if (roomId) payload.roomId = roomId
      }

      const res = await fetch("/api/trial-lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setTrialError(data.error || "Ошибка при записи на пробное")
        return
      }

      setTrialOpen(false)
      router.refresh()
    } catch {
      setTrialError("Ошибка сети")
    } finally {
      setTrialLoading(false)
    }
  }

  const filteredGroups = directionId
    ? groups.filter((g) => g.directionId === directionId)
    : []
  const selectedWard = wards.find((w) => w.id === wardId)
  const selectedDirection = directions.find((d) => d.id === directionId)
  const selectedGroup = filteredGroups.find((g) => g.id === groupId)

  const noWards = wards.length === 0

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={statusValue} onValueChange={handleStatusChange}>
        <SelectTrigger
          className="h-7 min-w-[170px] text-xs"
          disabled={statusLoading}
        >
          {STATUS_OPTIONS.find((s) => s.value === statusValue)?.label ||
            statusValue}
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog
        open={trialOpen}
        onOpenChange={(v) => {
          setTrialOpen(v)
          if (v) loadTrialOptions()
        }}
      >
        <DialogTrigger
          render={<Button variant="outline" size="sm" disabled={noWards} title={noWards ? "Сначала добавьте подопечного" : undefined} />}
        >
          <CalendarPlus className="size-3.5" />
          Записать на пробное
        </DialogTrigger>

        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Запись на пробное занятие</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleTrialSubmit} className="space-y-4">
            {trialError && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {trialError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Подопечный *</Label>
              <Select
                value={wardId}
                onValueChange={(v) => {
                  if (v) setWardId(v)
                }}
              >
                <SelectTrigger className="w-full">
                  {selectedWard ? (
                    wardName(selectedWard)
                  ) : (
                    <span className="text-muted-foreground">Выберите подопечного</span>
                  )}
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
                  {selectedDirection ? (
                    selectedDirection.name
                  ) : (
                    <span className="text-muted-foreground">Выберите направление</span>
                  )}
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
                    kind === "group"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  В группе
                </button>
                <button
                  type="button"
                  onClick={() => setKind("individual")}
                  className={`px-3 py-1 text-xs rounded-sm transition-colors ${
                    kind === "individual"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Индивидуальный
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
                  disabled={!directionId}
                >
                  <SelectTrigger className="w-full">
                    {selectedGroup ? (
                      selectedGroup.name
                    ) : (
                      <span className="text-muted-foreground">
                        {directionId ? "Выберите группу" : "Сначала выберите направление"}
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
                  <Select
                    value={instructorId}
                    onValueChange={(v) => {
                      if (v) setInstructorId(v)
                    }}
                  >
                    <SelectTrigger className="w-full">
                      {(() => {
                        const sel = instructorsList.find((e) => e.id === instructorId)
                        if (!sel) {
                          return <span className="text-muted-foreground">Выберите педагога</span>
                        }
                        return (
                          [sel.lastName, sel.firstName].filter(Boolean).join(" ") || "Без имени"
                        )
                      })()}
                    </SelectTrigger>
                    <SelectContent>
                      {instructorsList.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {[e.lastName, e.firstName].filter(Boolean).join(" ") || "Без имени"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Филиал</Label>
                    <Select
                      value={branchId}
                      onValueChange={(v) => {
                        if (v !== null) {
                          setBranchId(v)
                          setRoomId("")
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        {branchId ? (
                          branchesList.find((b) => b.id === branchId)?.name
                        ) : (
                          <span className="text-muted-foreground">Не выбран</span>
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Не выбран</SelectItem>
                        {branchesList.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Кабинет</Label>
                    <Select
                      value={roomId}
                      onValueChange={(v) => {
                        if (v !== null) setRoomId(v)
                      }}
                      disabled={!branchId}
                    >
                      <SelectTrigger className="w-full">
                        {roomId ? (
                          roomsList.find((r) => r.id === roomId)?.name
                        ) : (
                          <span className="text-muted-foreground">
                            {branchId ? "Не выбран" : "Сначала филиал"}
                          </span>
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Не выбран</SelectItem>
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
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Дата *</Label>
                <Input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                />
              </div>
              {kind === "individual" && (
                <div className="space-y-1.5">
                  <Label>Время *</Label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
              )}
            </div>

            {kind === "group" ? (
              <p className="text-xs text-muted-foreground">
                Дата должна совпадать с расписанием выбранной группы — пробное цепляется к существующему занятию.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Индивидуальный пробник: занятие не создаётся в общем расписании, отображается только в карточке лида.
              </p>
            )}

            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Особенности, пожелания..."
                rows={2}
              />
            </div>

            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                Отмена
              </DialogClose>
              <Button type="submit" disabled={trialLoading}>
                {trialLoading ? "Запись..." : "Записать"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
