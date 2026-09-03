"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Archive, ArchiveRestore, CalendarDays, ExternalLink, Users } from "lucide-react"
import Link from "next/link"
import { filterEmployeesByBranch, isEmployeeAvailableInBranch } from "@/lib/employee-branch-filter"
import { useRoleNames } from "@/components/role-names-provider"
import { MonthPicker } from "@/components/month-picker"

interface LessonData {
  id: string
  date: string
  startTime: string
  durationMinutes: number
  status: string
  statusLabel: string
  statusVariant: "default" | "secondary" | "destructive"
  instructor: string
  // ISO-дата + время: единый порядок для живых и удалённых строк.
  sortKey: string
}

// Строка архива удалённых занятий (deleted_lessons) — в сетке расписания её нет,
// показывается только здесь, чтобы было видно, что занятие было и кто его убрал.
interface DeletedLessonData {
  id: string
  date: string
  startTime: string
  durationMinutes: number
  instructor: string
  deletedBy: string
  deletedAt: string
  sortKey: string
}

interface EnrollmentData {
  id: string
  clientId: string
  wardId: string | null
  clientName: string
  clientPhone: string
  wardName: string | null
  wardBirthDate: string | null
  enrolledAt: string
  isActive: boolean
  paymentStatus: string
}

interface TemplateData {
  id: string
  dayOfWeek: number
  dayLabel: string
  startTime: string
  durationMinutes: number
}

interface DirectionOption {
  id: string
  name: string
  lessonDuration: number
}

interface BranchOption {
  id: string
  name: string
  rooms: { id: string; name: string }[]
}

interface InstructorOption {
  id: string
  firstName: string
  lastName: string
  employeeBranches: { branchId: string }[]
}

interface GroupInfo {
  id: string
  name: string
  directionId: string
  branchId: string
  roomId: string
  instructorId: string
  maxStudents: number
  // ISO YYYY-MM-DD или null — период жизни группы для автогенерации.
  startDate: string | null
  endDate: string | null
}

interface GroupTabsProps {
  groupId: string
  lessons: LessonData[]
  deletedLessons: DeletedLessonData[]
  canRestoreLessons: boolean
  enrollments: EnrollmentData[]
  templates: TemplateData[]
  scheduleStr: string
  currentMonth: number
  currentYear: number
  monthLabel: string
  isActive: boolean
  isArchived: boolean
  directions: DirectionOption[]
  branches: BranchOption[]
  instructors: InstructorOption[]
  groupInfo: GroupInfo
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  active: "Оплачено",
  awaiting_payment: "Ожидает оплаты",
  trial: "Пробное",
}

const MONTH_OPTIONS = [
  { value: 1, label: "Январь" },
  { value: 2, label: "Февраль" },
  { value: 3, label: "Март" },
  { value: 4, label: "Апрель" },
  { value: 5, label: "Май" },
  { value: 6, label: "Июнь" },
  { value: 7, label: "Июль" },
  { value: 8, label: "Август" },
  { value: 9, label: "Сентябрь" },
  { value: 10, label: "Октябрь" },
  { value: 11, label: "Ноябрь" },
  { value: 12, label: "Декабрь" },
]

export function GroupTabs({
  groupId,
  lessons,
  deletedLessons,
  canRestoreLessons,
  enrollments,
  templates,
  scheduleStr,
  currentMonth,
  currentYear,
  monthLabel,
  isActive,
  isArchived,
  directions,
  branches,
  instructors,
  groupInfo,
}: GroupTabsProps) {
  const router = useRouter()

  return (
    <Tabs defaultValue="schedule">
      <TabsList>
        <TabsTrigger value="schedule">Расписание</TabsTrigger>
        <TabsTrigger value="students">Состав</TabsTrigger>
        <TabsTrigger value="settings">Настройки</TabsTrigger>
      </TabsList>

      <TabsContent value="schedule">
        <ScheduleTab
          lessons={lessons}
          deletedLessons={deletedLessons}
          canRestore={canRestoreLessons}
          monthLabel={monthLabel}
          onRefresh={() => router.refresh()}
        />
      </TabsContent>

      <TabsContent value="students">
        <StudentsTab enrollments={enrollments} />
      </TabsContent>

      <TabsContent value="settings">
        <SettingsTab
          groupId={groupId}
          templates={templates}
          scheduleStr={scheduleStr}
          isActive={isActive}
          isArchived={isArchived}
          currentMonth={currentMonth}
          currentYear={currentYear}
          directions={directions}
          branches={branches}
          instructors={instructors}
          groupInfo={groupInfo}
          onRefresh={() => router.refresh()}
        />
      </TabsContent>
    </Tabs>
  )
}

// --- Расписание ---

function ScheduleTab({
  lessons,
  deletedLessons,
  canRestore,
  monthLabel,
  onRefresh,
}: {
  lessons: LessonData[]
  deletedLessons: DeletedLessonData[]
  canRestore: boolean
  monthLabel: string
  onRefresh: () => void
}) {
  const roleNames = useRoleNames()
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  // Живые и удалённые занятия — одним списком в хронологическом порядке, чтобы
  // пропуск в расписании был виден на своём месте, а не отдельной таблицей внизу.
  const rows = [
    ...lessons.map((l) => ({ kind: "live" as const, sortKey: l.sortKey, lesson: l })),
    ...deletedLessons.map((l) => ({ kind: "deleted" as const, sortKey: l.sortKey, deleted: l })),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  async function handleRestore(deletedLessonId: string) {
    setRestoringId(deletedLessonId)
    setRestoreError(null)
    try {
      const res = await fetch(`/api/deleted-lessons/${deletedLessonId}/restore`, {
        method: "POST",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRestoreError(data.error || "Не удалось восстановить занятие")
        return
      }
      onRefresh()
    } catch {
      setRestoreError("Не удалось восстановить занятие")
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-medium">
          Занятия за {monthLabel}
        </h3>
        <MonthPicker />
      </div>

      {restoreError && (
        <p className="text-sm text-destructive">{restoreError}</p>
      )}

      {rows.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <CalendarDays className="mx-auto size-10 opacity-50 mb-2" />
          <p>Нет занятий за этот месяц</p>
          <p className="text-xs mt-1">
            Расписание создаётся автоматически при создании группы и при
            изменении дат / шаблонов на вкладке «Инфо».
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Дата</TableHead>
              <TableHead>Время</TableHead>
              <TableHead>Длительность</TableHead>
              <TableHead>{roleNames.instructor}</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-[160px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) =>
              row.kind === "live" ? (
                <TableRow key={row.lesson.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell>
                    <Link href={`/schedule/lessons/${row.lesson.id}`} className="hover:underline">
                      {row.lesson.date}
                    </Link>
                  </TableCell>
                  <TableCell>{row.lesson.startTime}</TableCell>
                  <TableCell>{row.lesson.durationMinutes} мин</TableCell>
                  <TableCell>{row.lesson.instructor}</TableCell>
                  <TableCell>
                    <Badge variant={row.lesson.statusVariant}>
                      {row.lesson.statusLabel}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link href={`/schedule/lessons/${row.lesson.id}`}>
                      <ExternalLink className="size-4 text-muted-foreground" />
                    </Link>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={row.deleted.id} className="bg-muted/30 text-muted-foreground">
                  <TableCell className="line-through">{row.deleted.date}</TableCell>
                  <TableCell className="line-through">{row.deleted.startTime}</TableCell>
                  <TableCell className="line-through">{row.deleted.durationMinutes} мин</TableCell>
                  <TableCell className="line-through">{row.deleted.instructor}</TableCell>
                  <TableCell>
                    <Badge variant="outline">Удалено</Badge>
                    <div className="text-xs mt-1">
                      {row.deleted.deletedBy}, {row.deleted.deletedAt}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {canRestore && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={restoringId === row.deleted.id}
                        onClick={() => handleRestore(row.deleted.id)}
                      >
                        <ArchiveRestore className="size-4 mr-1" />
                        {restoringId === row.deleted.id ? "..." : "Восстановить"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

// --- Состав ---

function StudentsTab({
  enrollments,
}: {
  enrollments: EnrollmentData[]
}) {
  const activeEnrollments = enrollments.filter((e) => e.isActive)
  const inactiveEnrollments = enrollments.filter((e) => !e.isActive)

  return (
    <div className="space-y-4 mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-medium">
          Ученики ({activeEnrollments.length})
        </h3>
        <MonthPicker />
      </div>

      {activeEnrollments.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <Users className="mx-auto size-10 opacity-50 mb-2" />
          <p>В группе пока нет учеников</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Подопечный</TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead>Телефон</TableHead>
              <TableHead>Дата зачисления</TableHead>
              <TableHead>Статус оплаты</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeEnrollments.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">
                  {e.wardId && e.wardName ? (
                    <Link href={`/crm/wards/${e.wardId}`} className="text-primary hover:underline">
                      {e.wardName}
                    </Link>
                  ) : (
                    e.wardName || "—"
                  )}
                  {e.wardBirthDate && (
                    <span className="text-xs text-muted-foreground ml-1">
                      ({e.wardBirthDate})
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Link href={`/crm/clients/${e.clientId}`} className="text-primary hover:underline">
                    {e.clientName}
                  </Link>
                </TableCell>
                <TableCell>{e.clientPhone}</TableCell>
                <TableCell>{e.enrolledAt}</TableCell>
                <TableCell>
                  <Badge variant={e.paymentStatus === "active" ? "default" : "secondary"}>
                    {PAYMENT_STATUS_LABELS[e.paymentStatus] || e.paymentStatus}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {inactiveEnrollments.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Выбывшие ({inactiveEnrollments.length})
          </h4>
          <Table>
            <TableBody>
              {inactiveEnrollments.map((e) => (
                <TableRow key={e.id} className="opacity-60">
                  <TableCell>
                    {e.wardId && e.wardName ? (
                      <Link href={`/crm/wards/${e.wardId}`} className="text-primary hover:underline">
                        {e.wardName}
                      </Link>
                    ) : (
                      e.wardName || "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={`/crm/clients/${e.clientId}`} className="text-primary hover:underline">
                      {e.clientName}
                    </Link>
                  </TableCell>
                  <TableCell>{e.clientPhone}</TableCell>
                  <TableCell>{e.enrolledAt}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">Выбыл</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

// --- Настройки ---

const DAY_LABELS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"]
const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

interface EditableTemplate {
  key: string
  dayOfWeek: number
  startTime: string
  durationMinutes: number
}

function SettingsTab({
  groupId,
  templates,
  scheduleStr,
  isActive,
  isArchived,
  currentMonth,
  currentYear,
  directions,
  branches,
  instructors,
  groupInfo,
  onRefresh,
}: {
  groupId: string
  templates: TemplateData[]
  scheduleStr: string
  isActive: boolean
  isArchived: boolean
  currentMonth: number
  currentYear: number
  directions: DirectionOption[]
  branches: BranchOption[]
  instructors: InstructorOption[]
  groupInfo: GroupInfo
  onRefresh: () => void
}) {
  const roleNames = useRoleNames()

  // --- Основные данные группы ---
  const [infoName, setInfoName] = useState(groupInfo.name)
  const [infoDirectionId, setInfoDirectionId] = useState(groupInfo.directionId)
  const [infoBranchId, setInfoBranchId] = useState(groupInfo.branchId)
  const [infoRoomId, setInfoRoomId] = useState(groupInfo.roomId)
  const [infoInstructorId, setInfoInstructorId] = useState(groupInfo.instructorId)
  const [infoMaxStudents, setInfoMaxStudents] = useState(groupInfo.maxStudents)
  const [infoStartDate, setInfoStartDate] = useState(groupInfo.startDate ?? "")
  const [infoEndDate, setInfoEndDate] = useState(groupInfo.endDate ?? "")
  const [infoSaving, setInfoSaving] = useState(false)
  const [infoResult, setInfoResult] = useState<{ type: "success" | "error"; message: string } | null>(null)

  const selectedBranch = branches.find((b) => b.id === infoBranchId)
  const availableRooms = selectedBranch?.rooms ?? []

  async function handleInfoSave() {
    setInfoSaving(true)
    setInfoResult(null)
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: infoName,
          directionId: infoDirectionId,
          branchId: infoBranchId,
          roomId: infoRoomId,
          instructorId: infoInstructorId,
          maxStudents: infoMaxStudents,
          startDate: infoStartDate || null,
          endDate: infoEndDate || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setInfoResult({ type: "error", message: data.error || "Ошибка сохранения" })
      } else {
        setInfoResult({ type: "success", message: "Данные сохранены" })
        onRefresh()
      }
    } catch {
      setInfoResult({ type: "error", message: "Не удалось сохранить данные" })
    } finally {
      setInfoSaving(false)
    }
  }

  // --- Шаблоны расписания (read-only, задаются при создании группы) ---
  const rows: EditableTemplate[] = templates.map((t) => ({
    key: t.id,
    dayOfWeek: t.dayOfWeek,
    startTime: t.startTime,
    durationMinutes: t.durationMinutes,
  }))
  const [regenerating, setRegenerating] = useState(false)
  const [regenResult, setRegenResult] = useState<string | null>(null)
  const [regenDialogOpen, setRegenDialogOpen] = useState(false)
  const [regenMode, setRegenMode] = useState<"range" | "month">("range")
  const [regenMonth, setRegenMonth] = useState(currentMonth)
  const [regenYear, setRegenYear] = useState(currentYear)

  // Перегенерация. Два режима:
  //  • range — по всему сроку жизни группы [startDate, endDate]. Сначала
  //    сохраняем даты — и этот шаг НЕ additive: сохранение дат прогоняет
  //    regenerateOnDateChange, которая чистит занятия вне срока жизни и вне
  //    шаблонов. Занятия с отметками, с активными пробными и вручную
  //    перенесённые она сохраняет, остальные удаляет — итог показываем ниже,
  //    иначе удаление проходит бесследно (ни архива, ни истории).
  //  • month — точечно за выбранный месяц, additive.
  async function handleRegenerate() {
    setRegenerating(true)
    setRegenResult(null)
    try {
      if (regenMode === "range") {
        const saveRes = await fetch(`/api/groups/${groupId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate: infoStartDate || null,
            endDate: infoEndDate || null,
          }),
        })
        const saveData = await saveRes.json().catch(() => ({}))
        if (!saveRes.ok) {
          setRegenResult(saveData.error || "Не удалось сохранить даты группы")
          return
        }
        const regenRes = await fetch(`/api/groups/${groupId}/regenerate`, {
          method: "POST",
        })
        const data = await regenRes.json()
        if (!regenRes.ok) {
          setRegenResult(data.error || "Ошибка перегенерации")
          return
        }
        const notes: string[] = []
        const r = saveData.regen
        if (r) {
          if (r.deleted > 0) notes.push(`удалено ${r.deleted} вне шаблонов`)
          if (r.keptWithAttendance > 0) notes.push(`сохранено с отметками ${r.keptWithAttendance}`)
          if (r.keptWithTrials > 0) notes.push(`сохранено с пробными ${r.keptWithTrials}`)
          if (r.keptRescheduled > 0) notes.push(`сохранено перенесённых ${r.keptRescheduled}`)
        }
        if (data.skipped > 0) notes.push(`пропущено ${data.skipped} нерабочих`)
        setRegenResult(
          (data.created === 0
            ? `Все занятия уже существуют (${data.rangeStart} – ${data.rangeEnd})`
            : `Создано ${data.created} занятий (${data.rangeStart} – ${data.rangeEnd})`) +
            (notes.length > 0 ? `; ${notes.join(", ")}` : ""),
        )
        setRegenDialogOpen(false)
        onRefresh()
      } else {
        const res = await fetch(`/api/groups/${groupId}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ month: regenMonth, year: regenYear }),
        })
        const data = await res.json()
        if (!res.ok) {
          setRegenResult(data.error || "Ошибка генерации")
          return
        }
        setRegenResult(data.message)
        setRegenDialogOpen(false)
        onRefresh()
      }
    } catch {
      setRegenResult("Не удалось сгенерировать расписание")
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <div className="space-y-6 mt-4">
      {/* Основные данные */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Основные данные</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Название</Label>
              <Input
                value={infoName}
                onChange={(e) => setInfoName(e.target.value)}
                placeholder="Название группы"
              />
            </div>

            <div className="space-y-2">
              <Label>Направление</Label>
              <Select value={infoDirectionId} onValueChange={(v) => { if (v) setInfoDirectionId(v) }}>
                <SelectTrigger className="w-full">
                  {infoDirectionId ? directions.find((d) => d.id === infoDirectionId)?.name : <span className="text-muted-foreground">Выберите направление</span>}
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

            <div className="space-y-2">
              <Label>Филиал</Label>
              <Select
                value={infoBranchId}
                onValueChange={(v) => {
                  if (v) {
                    setInfoBranchId(v)
                    const branch = branches.find((b) => b.id === v)
                    if (branch && branch.rooms.length > 0) {
                      setInfoRoomId(branch.rooms[0].id)
                    } else {
                      setInfoRoomId("")
                    }
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  {infoBranchId ? branches.find((b) => b.id === infoBranchId)?.name : <span className="text-muted-foreground">Выберите филиал</span>}
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Кабинет</Label>
              <Select value={infoRoomId} onValueChange={(v) => { if (v) setInfoRoomId(v) }}>
                <SelectTrigger className="w-full">
                  {infoRoomId ? availableRooms.find((r) => r.id === infoRoomId)?.name : <span className="text-muted-foreground">Выберите кабинет</span>}
                </SelectTrigger>
                <SelectContent>
                  {availableRooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{roleNames.instructor}</Label>
              <Select value={infoInstructorId} onValueChange={(v) => { if (v) setInfoInstructorId(v) }}>
                <SelectTrigger className="w-full">
                  {infoInstructorId ? (() => { const i = instructors.find((i) => i.id === infoInstructorId); return i ? `${i.lastName} ${i.firstName}` : "" })() : <span className="text-muted-foreground">Выберите инструктора</span>}
                </SelectTrigger>
                <SelectContent>
                  {(() => {
                    const filtered = filterEmployeesByBranch(instructors, infoBranchId)
                    const selected = instructors.find((x) => x.id === infoInstructorId)
                    const showOutOfBranch =
                      selected && !isEmployeeAvailableInBranch(selected, infoBranchId)
                    const visible = showOutOfBranch
                      ? [selected!, ...filtered.filter((x) => x.id !== selected!.id)]
                      : filtered
                    return visible.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.lastName} {i.firstName}
                      </SelectItem>
                    ))
                  })()}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Макс. учеников</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={infoMaxStudents}
                onChange={(e) => setInfoMaxStudents(parseInt(e.target.value) || 1)}
              />
            </div>

            <div className="space-y-2">
              <Label>Дата старта</Label>
              <Input
                type="date"
                value={infoStartDate}
                onChange={(e) => setInfoStartDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Дата окончания</Label>
              <Input
                type="date"
                value={infoEndDate}
                onChange={(e) => setInfoEndDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Пусто = бессрочная (при генерации — год от старта).
              </p>
            </div>
          </div>

          {infoResult && (
            <div
              className={`rounded-md p-3 text-sm ${
                infoResult.type === "success"
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {infoResult.message}
            </div>
          )}

          <Button onClick={handleInfoSave} disabled={infoSaving}>
            {infoSaving ? "Сохранение..." : "Сохранить"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h3 className="text-base font-medium">Шаблоны расписания</h3>
        <p className="text-xs text-muted-foreground">
          Шаблоны задаются при создании группы и не редактируются.
        </p>
        {scheduleStr && (
          <p className="text-sm text-muted-foreground">{scheduleStr}</p>
        )}

        {rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>День</TableHead>
                <TableHead>Время</TableHead>
                <TableHead>Длительность (мин)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>
                    <Select value={String(row.dayOfWeek)} disabled>
                      <SelectTrigger className="w-[180px]">
                        {DAY_LABELS[row.dayOfWeek]}
                      </SelectTrigger>
                      <SelectContent>
                        {DAY_LABELS.map((label, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="time"
                      className="w-[130px]"
                      value={row.startTime}
                      readOnly
                      disabled
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      className="w-[100px]"
                      min={5}
                      max={480}
                      value={row.durationMinutes}
                      readOnly
                      disabled
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Нет шаблонов.
          </p>
        )}
      </div>

      <ArchiveSection groupId={groupId} isArchived={isArchived} onRefresh={onRefresh} />
    </div>
  )
}

// --- Архивация ---

function ArchiveSection({
  groupId,
  isArchived,
  onRefresh,
}: {
  groupId: string
  isArchived: boolean
  onRefresh: () => void
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleArchiveToggle() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive: !isArchived }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Ошибка")
        return
      }
      setConfirmOpen(false)
      if (!isArchived) {
        // После архивации — перенаправляем в список групп
        router.push("/schedule/groups")
      } else {
        onRefresh()
      }
    } catch {
      setError("Не удалось выполнить операцию")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-base font-medium">Управление</h3>
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        {!isArchived ? (
          <DialogTrigger render={<Button variant="destructive" />}>
            <Archive className="mr-2 size-4" />
            Архивировать группу
          </DialogTrigger>
        ) : (
          <DialogTrigger render={<Button variant="outline" />}>
            <ArchiveRestore className="mr-2 size-4" />
            Восстановить из архива
          </DialogTrigger>
        )}
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {!isArchived ? "Архивировать группу?" : "Восстановить группу?"}
            </DialogTitle>
            <DialogDescription>
              {!isArchived
                ? "Группа будет скрыта из расписания и списков зачисления. Данные сохранятся, группу можно будет восстановить."
                : "Группа снова станет активной и появится в расписании и списках зачисления."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Отмена
            </DialogClose>
            <Button
              variant={!isArchived ? "destructive" : "default"}
              onClick={handleArchiveToggle}
              disabled={loading}
            >
              {loading
                ? "Выполняется..."
                : !isArchived
                  ? "Архивировать"
                  : "Восстановить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <p className="text-xs text-muted-foreground">
        {!isArchived
          ? "Архивная группа не участвует в расписании и зачислении"
          : "Группа архивирована. Восстановите для активного использования."}
      </p>
    </div>
  )
}
