"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"
import type { SalesRow, SalesTabKey } from "./sales-table"

interface BranchOption {
  id: string
  name: string
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
interface EmployeeOption {
  id: string
  firstName: string | null
  lastName: string | null
}

// Какие поля пробного редактируемы (только на вкладке trial). На trial_done /
// awaiting_payment поля видны, но залочены — пробное уже состоялось.
function trialFieldsEditable(tab: SalesTabKey): boolean {
  return tab === "trial"
}

function isoToDate(iso: string | null): string {
  if (!iso) return ""
  return iso.slice(0, 10)
}

export function EditSalesRowDialog({
  row,
  tab,
  employees,
  open,
  onOpenChange,
}: {
  row: SalesRow
  tab: SalesTabKey
  employees: EmployeeOption[]
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Имя/фамилия в SalesRow хранятся как родителя (firstName/lastName), нам важно
  // эти строки разобрать. Имя ребёнка хранится в row.ward.
  const [parentFirstName, setParentFirstName] = useState(row.firstName || "")
  const [parentLastName, setParentLastName] = useState(row.lastName || "")
  const [phone, setPhone] = useState(row.phone || "")
  const [socialLink, setSocialLink] = useState(row.socialLink || "")
  const [wardFirstName, setWardFirstName] = useState(row.ward.firstName)
  const [wardLastName, setWardLastName] = useState(row.ward.lastName || "")
  const [comment, setComment] = useState(row.comment || "")
  const [assignedTo, setAssignedTo] = useState(row.assignedTo || "")

  const trialEditable = trialFieldsEditable(tab)
  const showsTrialFields =
    tab === "trial" || tab === "trial_done" || tab === "awaiting_payment"
  const showsApplicationFields = tab === "application"

  // Reference data — грузим лениво при первом open.
  const [branches, setBranches] = useState<BranchOption[]>([])
  const [directions, setDirections] = useState<DirectionOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [refLoaded, setRefLoaded] = useState(false)

  // Текущие выбранные значения трёх селектов выводим из row по name (server-rendered),
  // потом сопоставляем с подгруженным списком — устанавливаем id.
  const [branchId, setBranchId] = useState<string>("")
  const [directionId, setDirectionId] = useState<string>("")
  const [groupId, setGroupId] = useState<string>("")
  const [scheduledDate, setScheduledDate] = useState<string>(isoToDate(row.scheduledDate))
  // Список доступных дат пробного — реальные занятия выбранной группы.
  // null = ещё не загружены / нет группы; пустой массив = группа выбрана, занятий нет.
  const [groupLessonDates, setGroupLessonDates] = useState<string[] | null>(null)

  useEffect(() => {
    if (!open || refLoaded) return
    let cancelled = false
    async function load() {
      try {
        const [br, dr, gr] = await Promise.all([
          fetch("/api/branches"),
          fetch("/api/directions"),
          fetch("/api/groups"),
        ])
        if (cancelled) return
        if (br.ok) setBranches(await br.json())
        if (dr.ok) setDirections(await dr.json())
        if (gr.ok) setGroups(await gr.json())
        setRefLoaded(true)
      } catch {
        setError("Не удалось загрузить справочники")
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, refLoaded])

  // Когда справочники подгрузились — выставляем текущие id по совпадению name.
  useEffect(() => {
    if (!refLoaded) return
    if (!branchId && row.branchName) {
      const b = branches.find((x) => x.name === row.branchName)
      if (b) setBranchId(b.id)
    }
    if (!directionId && row.directionName) {
      const d = directions.find((x) => x.name === row.directionName)
      if (d) setDirectionId(d.id)
    }
    if (!groupId && row.groupOrTimeLabel) {
      const g = groups.find((x) => x.name === row.groupOrTimeLabel)
      if (g) setGroupId(g.id)
    }
  }, [refLoaded, branches, directions, groups, row, branchId, directionId, groupId])

  const filteredGroups = useMemo(
    () =>
      branchId && directionId
        ? groups.filter((g) => g.directionId === directionId && g.branchId === branchId)
        : [],
    [groups, branchId, directionId],
  )

  // При смене группы — подгружаем её реальные занятия (только будущие,
  // плюс текущая дата строки, если она в прошлом — чтобы select показывал её).
  useEffect(() => {
    if (!trialEditable || !groupId) {
      setGroupLessonDates(null)
      return
    }
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/groups/${groupId}/lessons`)
        if (!res.ok) {
          setGroupLessonDates([])
          return
        }
        const lessons: { date: string }[] = await res.json()
        if (cancelled) return
        const dates = lessons.map((l) => l.date.slice(0, 10))
        // Если у строки уже выставлена дата (старое пробное) и она не попала в
        // список (из-за поля from=today) — добавим, чтобы текущее значение было видимым.
        const initial = isoToDate(row.scheduledDate)
        if (initial && !dates.includes(initial)) dates.unshift(initial)
        setGroupLessonDates(dates)
        // Если текущая выбранная дата отсутствует в списке — сбрасываем в первую доступную.
        if (!dates.includes(scheduledDate) && dates.length > 0) {
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
    // scheduledDate намеренно не в deps — пересчитывать список нужно только при смене группы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, trialEditable, row.scheduledDate])

  const employeeOptions = useMemo(
    () =>
      employees.map((e) => ({
        value: e.id,
        label: [e.lastName, e.firstName].filter(Boolean).join(" ") || "Без имени",
      })),
    [employees],
  )

  const selectedBranchName = branches.find((b) => b.id === branchId)?.name ?? row.branchName ?? ""
  const selectedDirectionName = directions.find((d) => d.id === directionId)?.name ?? row.directionName ?? ""
  const selectedGroupName = filteredGroups.find((g) => g.id === groupId)?.name ?? row.groupOrTimeLabel ?? ""
  const selectedAssigneeName =
    employeeOptions.find((o) => o.value === assignedTo)?.label ?? "Не назначен"

  async function jsonFetch(url: string, method: string, body?: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        return { ok: false, error: d.error || `${method} ${url} → ${res.status}` }
      }
      return { ok: true }
    } catch {
      return { ok: false, error: "Сетевая ошибка" }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    // 1. Поля родителя (Client).
    const clientChanges: Record<string, unknown> = {}
    if (parentFirstName !== (row.firstName || "")) clientChanges.firstName = parentFirstName
    if (parentLastName !== (row.lastName || "")) clientChanges.lastName = parentLastName
    if (phone !== (row.phone || "")) clientChanges.phone = phone
    if (socialLink !== (row.socialLink || "")) clientChanges.socialLink = socialLink
    if (comment !== (row.comment || "")) clientChanges.comment = comment
    if ((assignedTo || null) !== (row.assignedTo || null)) clientChanges.assignedTo = assignedTo || null

    if (Object.keys(clientChanges).length > 0) {
      const r = await jsonFetch(`/api/clients/${row.clientId}`, "PATCH", clientChanges)
      if (!r.ok) {
        setError(r.error)
        setSubmitting(false)
        return
      }
    }

    // 2. Поля подопечного (Ward.firstName/lastName).
    const wardChanges: Record<string, unknown> = {}
    if (wardFirstName !== row.ward.firstName) wardChanges.firstName = wardFirstName
    if ((wardLastName || null) !== row.ward.lastName) wardChanges.lastName = wardLastName

    if (Object.keys(wardChanges).length > 0) {
      const r = await jsonFetch(`/api/wards/${row.ward.id}`, "PATCH", wardChanges)
      if (!r.ok) {
        setError(r.error)
        setSubmitting(false)
        return
      }
    }

    // 3. Заявка — обновляем поля Application (branch/direction). Если заявки
    // ещё нет (Ward создан через «+ Клиент» без Application) — создаём её,
    // когда заполнены оба поля; иначе синхронизируем филиал на Client (он же
    // отображается в таблице как фолбэк, когда Application нет).
    if (showsApplicationFields) {
      if (row.applicationId) {
        const appChanges: Record<string, unknown> = {}
        if (branchId && selectedBranchName !== row.branchName) appChanges.branchId = branchId
        if (directionId && selectedDirectionName !== row.directionName) appChanges.directionId = directionId
        if (Object.keys(appChanges).length > 0) {
          const r = await jsonFetch(`/api/applications/${row.applicationId}`, "PATCH", appChanges)
          if (!r.ok) {
            setError(r.error)
            setSubmitting(false)
            return
          }
        }
      } else if (branchId && directionId) {
        const r = await jsonFetch(`/api/applications`, "POST", {
          clientId: row.clientId,
          wardId: row.ward.id,
          branchId,
          directionId,
        })
        if (!r.ok) {
          setError(r.error)
          setSubmitting(false)
          return
        }
      } else if (branchId && selectedBranchName !== row.branchName) {
        const r = await jsonFetch(`/api/clients/${row.clientId}`, "PATCH", { branchId })
        if (!r.ok) {
          setError(r.error)
          setSubmitting(false)
          return
        }
      }
    }

    // 4. Пробное — если меняются «дата/филиал/направление/группа», старую запись
    // отменяем и создаём новую. row.rowId на вкладках trial/trial_done/awaiting_payment
    // равен Ward.id; конкретный TrialLesson.id у нас через row.lessonId не хранится,
    // поэтому грузим текущее scheduled-пробное Ward через API.
    if (trialEditable && showsTrialFields) {
      const trialChanged =
        scheduledDate !== isoToDate(row.scheduledDate) ||
        (branchId && selectedBranchName !== row.branchName) ||
        (directionId && selectedDirectionName !== row.directionName) ||
        (groupId && selectedGroupName !== row.groupOrTimeLabel)
      if (trialChanged) {
        if (row.trialLessonId) {
          const cancel = await jsonFetch(`/api/trial-lessons/${row.trialLessonId}`, "PATCH", {
            status: "cancelled",
          })
          if (!cancel.ok) {
            setError("Не удалось отменить старое пробное: " + cancel.error)
            setSubmitting(false)
            return
          }
        }
        const create = await jsonFetch(`/api/trial-lessons`, "POST", {
          clientId: row.clientId,
          wardId: row.ward.id,
          groupId: groupId || undefined,
          scheduledDate,
        })
        if (!create.ok) {
          setError("Старое пробное отменили, новое создать не удалось: " + create.error)
          setSubmitting(false)
          return
        }
      }
    }

    setSubmitting(false)
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Редактирование строки</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Родитель */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Фамилия родителя</Label>
              <Input value={parentLastName} onChange={(e) => setParentLastName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Имя родителя</Label>
              <Input value={parentFirstName} onChange={(e) => setParentFirstName(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Телефон</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Соцсети</Label>
            <Input value={socialLink} onChange={(e) => setSocialLink(e.target.value)} placeholder="ссылка" />
          </div>

          {/* Ребёнок */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Фамилия ребёнка</Label>
              <Input value={wardLastName} onChange={(e) => setWardLastName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Имя ребёнка</Label>
              <Input value={wardFirstName} onChange={(e) => setWardFirstName(e.target.value)} />
            </div>
          </div>

          {/* Пробное / Заявка — общие поля branch/direction */}
          {(showsTrialFields || showsApplicationFields) && (
            <div className="space-y-1.5">
              <Label>Филиал {showsTrialFields && !trialEditable ? "(только просмотр)" : ""}</Label>
              <Select
                value={branchId}
                onValueChange={(v) => {
                  if (v) {
                    setBranchId(v)
                    setGroupId("")
                  }
                }}
                disabled={showsTrialFields && !trialEditable}
              >
                <SelectTrigger className="w-full">{selectedBranchName || "—"}</SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {(showsTrialFields || showsApplicationFields) && (
            <div className="space-y-1.5">
              <Label>Направление {showsTrialFields && !trialEditable ? "(только просмотр)" : ""}</Label>
              <Select
                value={directionId}
                onValueChange={(v) => {
                  if (v) {
                    setDirectionId(v)
                    setGroupId("")
                  }
                }}
                disabled={showsTrialFields && !trialEditable}
              >
                <SelectTrigger className="w-full">{selectedDirectionName || "—"}</SelectTrigger>
                <SelectContent>
                  {directions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Пробное — сначала группа (определяет доступные даты), потом дата */}
          {showsTrialFields && (
            <>
              <div className="space-y-1.5">
                <Label>Группа {!trialEditable ? "(только просмотр)" : ""}</Label>
                <Select
                  value={groupId}
                  onValueChange={(v) => v && setGroupId(v)}
                  disabled={!trialEditable || !branchId || !directionId}
                >
                  <SelectTrigger className="w-full">{selectedGroupName || "—"}</SelectTrigger>
                  <SelectContent>
                    {filteredGroups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Дата пробного {!trialEditable ? "(только просмотр)" : ""}</Label>
                {trialEditable && groupId ? (
                  <Calendar
                    value={scheduledDate}
                    onChange={setScheduledDate}
                    availableDates={groupLessonDates ? new Set(groupLessonDates) : undefined}
                    emptyHint="Сначала сгенерируйте расписание для этой группы."
                  />
                ) : (
                  <Input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    disabled={!trialEditable}
                  />
                )}
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label>Комментарий</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Ответственный</Label>
            <Select value={assignedTo} onValueChange={(v) => setAssignedTo(v || "")}>
              <SelectTrigger className="w-full">{selectedAssigneeName}</SelectTrigger>
              <SelectContent>
                {employeeOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
