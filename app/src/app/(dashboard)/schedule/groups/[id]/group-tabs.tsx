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
import { CalendarDays, Plus, UserPlus, Users } from "lucide-react"

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

interface ClientOption {
  id: string
  name: string
  phone: string
  wards: { id: string; name: string }[]
}

interface GroupTabsProps {
  groupId: string
  lessons: LessonData[]
  enrollments: EnrollmentData[]
  templates: TemplateData[]
  clients: ClientOption[]
  scheduleStr: string
  currentMonth: number
  currentYear: number
  monthLabel: string
  isActive: boolean
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
  clients,
  scheduleStr,
  currentMonth,
  currentYear,
  monthLabel,
  isActive,
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
          groupId={groupId}
          enrollments={enrollments}
          clients={clients}
          onRefresh={() => router.refresh()}
        />
      </TabsContent>

      <TabsContent value="settings">
        <SettingsTab
          templates={templates}
          scheduleStr={scheduleStr}
          isActive={isActive}
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {lessons.map((lesson) => (
              <TableRow key={lesson.id}>
                <TableCell>{lesson.date}</TableCell>
                <TableCell>{lesson.startTime}</TableCell>
                <TableCell>{lesson.durationMinutes} мин</TableCell>
                <TableCell>{lesson.instructor}</TableCell>
                <TableCell>
                  <Badge variant={lesson.statusVariant}>
                    {lesson.statusLabel}
                  </Badge>
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
  groupId,
  enrollments,
  clients,
  onRefresh,
}: {
  groupId: string
  enrollments: EnrollmentData[]
  clients: ClientOption[]
  onRefresh: () => void
}) {
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [enrolling, setEnrolling] = useState(false)
  const [enrollError, setEnrollError] = useState<string | null>(null)
  const [selectedClientId, setSelectedClientId] = useState("")
  const [selectedWardId, setSelectedWardId] = useState("")

  const selectedClient = clients.find((c) => c.id === selectedClientId)
  const activeEnrollments = enrollments.filter((e) => e.isActive)
  const inactiveEnrollments = enrollments.filter((e) => !e.isActive)

  async function handleEnroll() {
    setEnrolling(true)
    setEnrollError(null)
    try {
      const res = await fetch(`/api/groups/${groupId}/enrollments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClientId,
          wardId: selectedWardId || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setEnrollError(data.error || "Ошибка зачисления")
        return
      }
      setEnrollOpen(false)
      setSelectedClientId("")
      setSelectedWardId("")
      onRefresh()
    } catch {
      setEnrollError("Не удалось зачислить ученика")
    } finally {
      setEnrolling(false)
    }
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium">
          Ученики ({activeEnrollments.length})
        </h3>
        <Dialog
          open={enrollOpen}
          onOpenChange={(val) => {
            setEnrollOpen(val)
            if (!val) {
              setSelectedClientId("")
              setSelectedWardId("")
              setEnrollError(null)
            }
          }}
        >
          <DialogTrigger render={<Button size="sm" />}>
            <UserPlus className="mr-2 size-4" />
            Зачислить
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Зачислить ученика</DialogTitle>
              <DialogDescription>
                Выберите клиента и подопечного для зачисления в группу
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {enrollError && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {enrollError}
                </div>
              )}

              <div className="space-y-2">
                <Label>Клиент</Label>
                <Select
                  value={selectedClientId}
                  onValueChange={(val) => {
                    if (val) setSelectedClientId(val)
                    setSelectedWardId("")
                  }}
                >
                  <SelectTrigger className="w-full">
                    {selectedClientId ? (() => { const c = clients.find(c => c.id === selectedClientId); return c ? `${c.name}${c.phone ? ` (${c.phone})` : ""}` : "" })() : <span className="text-muted-foreground">Выберите клиента</span>}
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} {c.phone ? `(${c.phone})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedClient && selectedClient.wards.length > 0 && (
                <div className="space-y-2">
                  <Label>Подопечный</Label>
                  <Select value={selectedWardId} onValueChange={(v) => { if (v) setSelectedWardId(v) }}>
                    <SelectTrigger className="w-full">
                      {selectedWardId ? selectedClient?.wards.find(w => w.id === selectedWardId)?.name : <span className="text-muted-foreground">Выберите подопечного (необязательно)</span>}
                    </SelectTrigger>
                    <SelectContent>
                      {selectedClient.wards.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Отмена
              </DialogClose>
              <Button onClick={handleEnroll} disabled={enrolling || !selectedClientId}>
                {enrolling ? "Зачисление..." : "Зачислить"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
    </div>
  )
}

// --- Настройки ---

function SettingsTab({
  templates,
  scheduleStr,
  isActive,
}: {
  templates: TemplateData[]
  scheduleStr: string
  isActive: boolean
}) {
  return (
    <div className="space-y-6 mt-4">
      <div className="space-y-4">
        <h3 className="text-base font-medium">Шаблоны расписания</h3>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нет шаблонов расписания. Добавьте их при редактировании группы.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{scheduleStr}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>День</TableHead>
                  <TableHead>Время</TableHead>
                  <TableHead>Длительность</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.dayLabel}</TableCell>
                    <TableCell>{t.startTime}</TableCell>
                    <TableCell>{t.durationMinutes} мин</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-base font-medium">Управление</h3>
        <div className="flex gap-2">
          <Button variant="outline" disabled>
            Редактировать группу
          </Button>
          {isActive ? (
            <Button variant="destructive" disabled>
              Архивировать группу
            </Button>
          ) : (
            <Button variant="outline" disabled>
              Восстановить из архива
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Редактирование и архивация будут доступны в следующей версии
        </p>
      </div>
    </div>
  )
}
