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
import { Archive, ArchiveRestore, ArrowRightLeft, CalendarDays, ExternalLink, Plus, Trash2, Users } from "lucide-react"
import Link from "next/link"
import { filterEmployeesByBranch, isEmployeeAvailableInBranch } from "@/lib/employee-branch-filter"

interface LessonData {
  id: string
  date: string
  startTime: string
  durationMinutes: number
  status: string
  statusLabel: string
  statusVariant: "default" | "secondary" | "destructive"
  instructor: string
}

interface EnrollmentData {
  id: string
  clientId: string
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
}

interface TransferGroupOption {
  id: string
  name: string
  directionName: string
  enrolled: number
  maxStudents: number
}

interface GroupTabsProps {
  groupId: string
  lessons: LessonData[]
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
  groupsForTransfer: TransferGroupOption[]
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
  groupsForTransfer,
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
          groupId={groupId}
          lessons={lessons}
          currentMonth={currentMonth}
          currentYear={currentYear}
          monthLabel={monthLabel}
          onRefresh={() => router.refresh()}
        />
      </TabsContent>

      <TabsContent value="students">
        <StudentsTab
          enrollments={enrollments}
          groupsForTransfer={groupsForTransfer}
          onRefresh={() => router.refresh()}
        />
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
  groupId,
  lessons,
  currentMonth,
  currentYear,
  monthLabel,
  onRefresh,
}: {
  groupId: string
  lessons: LessonData[]
  currentMonth: number
  currentYear: number
  monthLabel: string
  onRefresh: () => void
}) {
  const [generating, setGenerating] = useState(false)
  const [genMonth, setGenMonth] = useState(currentMonth)
  const [genYear, setGenYear] = useState(currentYear)
  const [genResult, setGenResult] = useState<string | null>(null)
  const [genDialogOpen, setGenDialogOpen] = useState(false)

  async function handleGenerate() {
    setGenerating(true)
    setGenResult(null)
    try {
      const res = await fetch(`/api/groups/${groupId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: genMonth, year: genYear }),
      })
      const data = await res.json()
      if (!res.ok) {
        setGenResult(data.error || "Ошибка генерации")
      } else {
        setGenResult(data.message)
        setGenDialogOpen(false)
        onRefresh()
      }
    } catch {
      setGenResult("Не удалось сгенерировать расписание")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium">
          Занятия за {monthLabel}
        </h3>
        <Dialog open={genDialogOpen} onOpenChange={setGenDialogOpen}>
          <DialogTrigger render={<Button variant="outline" size="sm" />}>
            <CalendarDays className="mr-2 size-4" />
            Сгенерировать расписание
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Генерация занятий</DialogTitle>
              <DialogDescription>
                Занятия будут созданы по шаблонам расписания. Существующие занятия не затрагиваются.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Месяц</Label>
                <Select value={String(genMonth)} onValueChange={(v) => { if (v) setGenMonth(parseInt(v)) }}>
                  <SelectTrigger className="w-full">
                    {MONTH_OPTIONS.find(m => String(m.value) === String(genMonth))?.label ?? <span className="text-muted-foreground">Месяц</span>}
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_OPTIONS.map((m) => (
                      <SelectItem key={m.value} value={String(m.value)}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Год</Label>
                <Input
                  type="number"
                  value={genYear}
                  onChange={(e) => setGenYear(parseInt(e.target.value) || currentYear)}
                />
              </div>
            </div>
            {genResult && (
              <div className="rounded-md bg-muted p-3 text-sm">{genResult}</div>
            )}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Отмена
              </DialogClose>
              <Button onClick={handleGenerate} disabled={generating}>
                {generating ? "Генерация..." : "Сгенерировать"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {lessons.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <CalendarDays className="mx-auto size-10 opacity-50 mb-2" />
          <p>Нет занятий за этот месяц</p>
          <p className="text-xs mt-1">Используйте генерацию расписания</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Дата</TableHead>
              <TableHead>Время</TableHead>
              <TableHead>Длительность</TableHead>
              <TableHead>Педагог</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-[40px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lessons.map((lesson) => (
              <TableRow key={lesson.id} className="cursor-pointer hover:bg-muted/50">
                <TableCell>
                  <Link href={`/schedule/lessons/${lesson.id}`} className="hover:underline">
                    {lesson.date}
                  </Link>
                </TableCell>
                <TableCell>{lesson.startTime}</TableCell>
                <TableCell>{lesson.durationMinutes} мин</TableCell>
                <TableCell>{lesson.instructor}</TableCell>
                <TableCell>
                  <Badge variant={lesson.statusVariant}>
                    {lesson.statusLabel}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Link href={`/schedule/lessons/${lesson.id}`}>
                    <ExternalLink className="size-4 text-muted-foreground" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

// --- Состав ---

function StudentsTab({
  enrollments,
  groupsForTransfer,
  onRefresh,
}: {
  enrollments: EnrollmentData[]
  groupsForTransfer: TransferGroupOption[]
  onRefresh: () => void
}) {
  // Transfer state
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferEnrollmentId, setTransferEnrollmentId] = useState("")
  const [transferStudentName, setTransferStudentName] = useState("")
  const [targetGroupId, setTargetGroupId] = useState("")
  const [transferring, setTransferring] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)

  const activeEnrollments = enrollments.filter((e) => e.isActive)
  const inactiveEnrollments = enrollments.filter((e) => !e.isActive)

  function openTransfer(enrollment: EnrollmentData) {
    setTransferEnrollmentId(enrollment.id)
    setTransferStudentName(enrollment.wardName || enrollment.clientName)
    setTargetGroupId("")
    setTransferError(null)
    setTransferOpen(true)
  }

  async function handleTransfer() {
    if (!targetGroupId) {
      setTransferError("Выберите группу для перевода")
      return
    }
    setTransferring(true)
    setTransferError(null)
    try {
      const res = await fetch(`/api/enrollments/${transferEnrollmentId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetGroupId }),
      })
      if (!res.ok) {
        const data = await res.json()
        setTransferError(data.error || "Ошибка перевода")
        return
      }
      setTransferOpen(false)
      onRefresh()
    } catch {
      setTransferError("Не удалось выполнить перевод")
    } finally {
      setTransferring(false)
    }
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium">
          Ученики ({activeEnrollments.length})
        </h3>
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
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeEnrollments.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">
                  {e.wardName || "—"}
                  {e.wardBirthDate && (
                    <span className="text-xs text-muted-foreground ml-1">
                      ({e.wardBirthDate})
                    </span>
                  )}
                </TableCell>
                <TableCell>{e.clientName}</TableCell>
                <TableCell>{e.clientPhone}</TableCell>
                <TableCell>{e.enrolledAt}</TableCell>
                <TableCell>
                  <Badge variant={e.paymentStatus === "active" ? "default" : "secondary"}>
                    {PAYMENT_STATUS_LABELS[e.paymentStatus] || e.paymentStatus}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    title="Перевести в другую группу"
                    onClick={() => openTransfer(e)}
                  >
                    <ArrowRightLeft className="size-4 text-muted-foreground" />
                  </Button>
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
                  <TableCell>{e.wardName || "—"}</TableCell>
                  <TableCell>{e.clientName}</TableCell>
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

      {/* Диалог перевода */}
      <Dialog
        open={transferOpen}
        onOpenChange={(val) => {
          setTransferOpen(val)
          if (!val) setTransferError(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Перевод ученика</DialogTitle>
            <DialogDescription>
              {transferStudentName} — выберите группу для перевода
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {transferError && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {transferError}
              </div>
            )}

            <div className="space-y-2">
              <Label>Целевая группа</Label>
              <Select value={targetGroupId} onValueChange={(v) => { if (v) setTargetGroupId(v) }}>
                <SelectTrigger className="w-full">
                  {targetGroupId
                    ? groupsForTransfer.find((g) => g.id === targetGroupId)?.name
                    : <span className="text-muted-foreground">Выберите группу</span>}
                </SelectTrigger>
                <SelectContent>
                  {groupsForTransfer.map((g) => (
                    <SelectItem
                      key={g.id}
                      value={g.id}
                      disabled={g.enrolled >= g.maxStudents}
                    >
                      {g.name} ({g.directionName}) — {g.enrolled}/{g.maxStudents}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleTransfer} disabled={transferring || !targetGroupId}>
              {transferring ? "Перевод..." : "Перевести"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  // --- Основные данные группы ---
  const [infoName, setInfoName] = useState(groupInfo.name)
  const [infoDirectionId, setInfoDirectionId] = useState(groupInfo.directionId)
  const [infoBranchId, setInfoBranchId] = useState(groupInfo.branchId)
  const [infoRoomId, setInfoRoomId] = useState(groupInfo.roomId)
  const [infoInstructorId, setInfoInstructorId] = useState(groupInfo.instructorId)
  const [infoMaxStudents, setInfoMaxStudents] = useState(groupInfo.maxStudents)
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

  // --- Шаблоны расписания ---
  const [rows, setRows] = useState<EditableTemplate[]>(() =>
    templates.map((t) => ({
      key: t.id,
      dayOfWeek: t.dayOfWeek,
      startTime: t.startTime,
      durationMinutes: t.durationMinutes,
    }))
  )
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [regenResult, setRegenResult] = useState<string | null>(null)
  const [regenDialogOpen, setRegenDialogOpen] = useState(false)
  const [regenMonth, setRegenMonth] = useState(currentMonth)
  const [regenYear, setRegenYear] = useState(currentYear)

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        dayOfWeek: 0,
        startTime: "10:00",
        durationMinutes: directions.find(d => d.id === infoDirectionId)?.lessonDuration ?? 45,
      },
    ])
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key))
  }

  function updateRow(key: string, field: keyof Omit<EditableTemplate, "key">, value: string | number) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r))
    )
  }

  async function handleSave() {
    setSaving(true)
    setSaveResult(null)
    try {
      const res = await fetch(`/api/groups/${groupId}/templates`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templates: rows.map((r) => ({
            dayOfWeek: r.dayOfWeek,
            startTime: r.startTime,
            durationMinutes: r.durationMinutes,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveResult({ type: "error", message: data.error || "Ошибка сохранения" })
      } else {
        setSaveResult({ type: "success", message: "Шаблоны сохранены" })
        onRefresh()
      }
    } catch {
      setSaveResult({ type: "error", message: "Не удалось сохранить шаблоны" })
    } finally {
      setSaving(false)
    }
  }

  async function handleRegenerate() {
    setRegenerating(true)
    setRegenResult(null)
    try {
      const res = await fetch(`/api/groups/${groupId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: regenMonth, year: regenYear }),
      })
      const data = await res.json()
      if (!res.ok) {
        setRegenResult(data.error || "Ошибка генерации")
      } else {
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
              <Label>Педагог</Label>
              <Select value={infoInstructorId} onValueChange={(v) => { if (v) setInfoInstructorId(v) }}>
                <SelectTrigger className="w-full">
                  {infoInstructorId ? (() => { const i = instructors.find((i) => i.id === infoInstructorId); return i ? `${i.lastName} ${i.firstName}` : "" })() : <span className="text-muted-foreground">Выберите педагога</span>}
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
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>
                    <Select
                      value={String(row.dayOfWeek)}
                      onValueChange={(v) => {
                        if (v) updateRow(row.key, "dayOfWeek", parseInt(v))
                      }}
                    >
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
                      onChange={(e) => updateRow(row.key, "startTime", e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      className="w-[100px]"
                      min={5}
                      max={480}
                      value={row.durationMinutes}
                      onChange={(e) =>
                        updateRow(row.key, "durationMinutes", parseInt(e.target.value) || 0)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(row.key)}
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Нет шаблонов. Добавьте дни занятий.
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-2 size-4" />
            Добавить день
          </Button>
        </div>

        {saveResult && (
          <div
            className={`rounded-md p-3 text-sm ${
              saveResult.type === "success"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {saveResult.message}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Сохранение..." : "Сохранить расписание"}
          </Button>

          <Dialog open={regenDialogOpen} onOpenChange={(v) => { setRegenDialogOpen(v); if (!v) setRegenResult(null) }}>
            <DialogTrigger render={<Button variant="outline" />}>
              <CalendarDays className="mr-2 size-4" />
              Перегенерировать
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Перегенерация занятий</DialogTitle>
                <DialogDescription>
                  Новые занятия будут созданы по текущим шаблонам расписания. Существующие занятия не затрагиваются.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Месяц</Label>
                  <Select value={String(regenMonth)} onValueChange={(v) => { if (v) setRegenMonth(parseInt(v)) }}>
                    <SelectTrigger className="w-full">
                      {MONTH_OPTIONS.find(m => String(m.value) === String(regenMonth))?.label ?? <span className="text-muted-foreground">Месяц</span>}
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_OPTIONS.map((m) => (
                        <SelectItem key={m.value} value={String(m.value)}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Год</Label>
                  <Input
                    type="number"
                    value={regenYear}
                    onChange={(e) => setRegenYear(parseInt(e.target.value) || currentYear)}
                  />
                </div>
              </div>
              {regenResult && (
                <div className="rounded-md bg-muted p-3 text-sm">{regenResult}</div>
              )}
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Отмена
                </DialogClose>
                <Button onClick={handleRegenerate} disabled={regenerating}>
                  {regenerating ? "Генерация..." : "Сгенерировать"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
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
