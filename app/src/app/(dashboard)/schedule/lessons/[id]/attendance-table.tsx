"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CheckCircle2, Loader2, Users, UserCheck, UserPlus, X } from "lucide-react"

interface AbsenceReasonData {
  id: string
  name: string
}

interface StudentData {
  enrollmentId: string
  clientId: string
  clientName: string
  clientPhone: string | null
  wardId: string | null
  wardName: string | null
  subscriptionId: string | null
  lessonPrice: number
  isMakeup?: boolean
  attendance: {
    id: string
    attendanceTypeId: string
    attendanceTypeName: string
    attendanceTypeCode: string
    chargeAmount: number
    instructorPayAmount: number
    instructorPayEnabled: boolean
    absenceReasonId?: string | null
  } | null
}

interface AttendanceTypeData {
  id: string
  name: string
  code: string
  chargesSubscription: boolean
  paysInstructor: boolean
}

interface SalaryRateData {
  scheme: string
  ratePerStudent: number | null
  ratePerLesson: number | null
  fixedPerShift: number | null
}

interface InstructorOption {
  id: string
  name: string
}

interface TrialStudentData {
  trialId: string
  clientId: string
  clientName: string
  clientPhone: string | null
  wardId: string | null
  wardName: string | null
  status: "scheduled" | "attended" | "no_show"
  instructorPayEnabled: boolean
  instructorPayAmount: number
}

const TRIAL_STATUS_LABELS: Record<string, string> = {
  scheduled: "Не отмечен",
  attended: "Пришёл",
  no_show: "Не пришёл",
  cancelled: "Отменено",
}

const TRIAL_STATUS_OPTIONS = [
  { value: "scheduled", label: "Не отмечен" },
  { value: "attended", label: "Пришёл" },
  { value: "no_show", label: "Не пришёл" },
  { value: "cancelled", label: "Отменить запись" },
]

interface MakeupSearchResult {
  clientId: string
  clientName: string
  wardId: string | null
  wardName: string | null
  subscriptionId: string
  subscriptionLabel: string
  balance: number
  lessonPrice: number
}

interface AttendanceTableProps {
  lessonId: string
  groupId?: string
  topic: string | null
  homework: string | null
  students: StudentData[]
  makeupStudents?: StudentData[]
  trialStudents?: TrialStudentData[]
  attendanceTypes: AttendanceTypeData[]
  salaryRate: SalaryRateData | null
  absenceReasons?: AbsenceReasonData[]
  instructorName?: string
  substituteInstructorId?: string | null
  substituteInstructorName?: string | null
  instructors?: InstructorOption[]
}

function formatMoney(amount: number): string {
  if (amount === 0) return "0 \u20BD"
  return new Intl.NumberFormat("ru-RU").format(amount) + " \u20BD"
}

export function AttendanceTable({
  lessonId,
  groupId,
  topic: initialTopic,
  homework: initialHomework,
  students: initialStudents,
  makeupStudents: initialMakeupStudents = [],
  trialStudents: initialTrialStudents = [],
  attendanceTypes,
  salaryRate,
  absenceReasons = [],
  instructorName,
  substituteInstructorId: initSubstituteId,
  substituteInstructorName: initSubstituteName,
  instructors = [],
}: AttendanceTableProps) {
  const router = useRouter()
  const [students, setStudents] = useState(initialStudents)
  const [makeupStudents, setMakeupStudents] = useState(initialMakeupStudents)
  const [trialStudents, setTrialStudents] = useState(initialTrialStudents)
  const [loadingTrialId, setLoadingTrialId] = useState<string | null>(null)
  const [topic, setTopic] = useState(initialTopic || "")
  const [homework, setHomework] = useState(initialHomework || "")
  const [savingTopic, setSavingTopic] = useState(false)
  const [savingHomework, setSavingHomework] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [loadingStudentId, setLoadingStudentId] = useState<string | null>(null)
  const [substituteId, setSubstituteId] = useState<string | null>(initSubstituteId || null)
  const [substituteName, setSubstituteName] = useState<string | null>(initSubstituteName || null)
  const [savingSubstitute, setSavingSubstitute] = useState(false)

  // Makeup dialog state
  const [makeupDialogOpen, setMakeupDialogOpen] = useState(false)
  const [makeupSearch, setMakeupSearch] = useState("")
  const [makeupSearchResults, setMakeupSearchResults] = useState<MakeupSearchResult[]>([])
  const [makeupSearching, setMakeupSearching] = useState(false)
  const [addingMakeup, setAddingMakeup] = useState(false)

  const presentType = attendanceTypes.find((t) => t.code === "present")

  // All students combined (enrolled + makeup)
  const allStudents = [...students, ...makeupStudents]

  // Auto-save topic
  const saveField = useCallback(
    async (field: "topic" | "homework", value: string) => {
      const setter = field === "topic" ? setSavingTopic : setSavingHomework
      setter(true)
      try {
        await fetch(`/api/lessons/${lessonId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value || null }),
        })
      } catch {
        // Silently fail, data is still in local state
      } finally {
        setter(false)
      }
    },
    [lessonId]
  )

  // Set/remove substitute instructor
  async function setSubstituteInstructor(instructorId: string | null) {
    setSavingSubstitute(true)
    try {
      const res = await fetch(`/api/lessons/${lessonId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ substituteInstructorId: instructorId }),
      })
      if (res.ok) {
        setSubstituteId(instructorId)
        if (instructorId) {
          const inst = instructors.find((i) => i.id === instructorId)
          setSubstituteName(inst?.name || null)
        } else {
          setSubstituteName(null)
        }
        router.refresh()
      }
    } catch {
      // silently fail
    } finally {
      setSavingSubstitute(false)
    }
  }

  // Mark single student
  async function markAttendance(
    student: StudentData,
    attendanceTypeId: string,
    instructorPayEnabled: boolean = true
  ) {
    const uniqueKey = student.enrollmentId
    setLoadingStudentId(uniqueKey)

    try {
      const res = await fetch(`/api/lessons/${lessonId}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: student.clientId,
          wardId: student.wardId,
          subscriptionId: student.subscriptionId,
          attendanceTypeId,
          instructorPayEnabled,
        }),
      })

      if (res.ok) {
        // Refresh to get updated data
        router.refresh()
        // Also update local state optimistically
        const attType = attendanceTypes.find((t) => t.id === attendanceTypeId)
        if (attType) {
          const chargeAmount = attType.chargesSubscription ? student.lessonPrice : 0
          let instructorPayAmount = 0
          if (attType.paysInstructor && instructorPayEnabled && salaryRate) {
            if (salaryRate.scheme === "per_student" && salaryRate.ratePerStudent) {
              instructorPayAmount = salaryRate.ratePerStudent
            } else if (salaryRate.scheme === "per_lesson" && salaryRate.ratePerLesson) {
              // Approximate — server calculates precisely
              instructorPayAmount = salaryRate.ratePerLesson
            } else if (salaryRate.scheme === "fixed_plus_per_student" && salaryRate.ratePerStudent) {
              instructorPayAmount = salaryRate.ratePerStudent
            }
          }

          const updateFn = (prev: StudentData[]) =>
            prev.map((s) =>
              s.enrollmentId === student.enrollmentId
                ? {
                    ...s,
                    attendance: {
                      id: s.attendance?.id || "temp",
                      attendanceTypeId,
                      attendanceTypeName: attType.name,
                      attendanceTypeCode: attType.code,
                      chargeAmount,
                      instructorPayAmount,
                      instructorPayEnabled,
                    },
                  }
                : s
            )

          if (student.isMakeup) {
            setMakeupStudents(updateFn)
          } else {
            setStudents(updateFn)
          }
        }
      }
    } catch {
      // Error handling — could show toast
    } finally {
      setLoadingStudentId(null)
    }
  }

  // Mark all as present
  async function markAllPresent() {
    if (!presentType) return
    setMarkingAll(true)
    try {
      const res = await fetch(`/api/lessons/${lessonId}/attendance`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendanceTypeId: presentType.id }),
      })
      if (res.ok) {
        router.refresh()
        // Optimistic update
        setStudents((prev) =>
          prev.map((s) => {
            const chargeAmount = presentType.chargesSubscription ? s.lessonPrice : 0
            let instructorPayAmount = 0
            if (presentType.paysInstructor && salaryRate) {
              if (salaryRate.scheme === "per_student" && salaryRate.ratePerStudent) {
                instructorPayAmount = salaryRate.ratePerStudent
              }
            }
            return {
              ...s,
              attendance: {
                id: s.attendance?.id || "temp",
                attendanceTypeId: presentType.id,
                attendanceTypeName: presentType.name,
                attendanceTypeCode: presentType.code,
                chargeAmount,
                instructorPayAmount,
                instructorPayEnabled: true,
              },
            }
          })
        )
      }
    } catch {
      // Error handling
    } finally {
      setMarkingAll(false)
    }
  }

  // Toggle instructor pay
  async function toggleInstructorPay(student: StudentData) {
    if (!student.attendance) return
    const newEnabled = !student.attendance.instructorPayEnabled
    await markAttendance(student, student.attendance.attendanceTypeId, newEnabled)
  }

  // Save absence reason
  async function saveAbsenceReason(student: StudentData, absenceReasonId: string | null) {
    if (!student.attendance) return
    try {
      await fetch(`/api/lessons/${lessonId}/attendance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attendanceId: student.attendance.id,
          absenceReasonId,
        }),
      })
      // Update local state
      const updateFn = (prev: StudentData[]) =>
        prev.map((s) =>
          s.enrollmentId === student.enrollmentId && s.attendance
            ? { ...s, attendance: { ...s.attendance, absenceReasonId } }
            : s
        )
      if (student.isMakeup) {
        setMakeupStudents(updateFn)
      } else {
        setStudents(updateFn)
      }
    } catch {
      // silently fail
    }
  }

  // Makeup: search for students from other groups
  async function searchMakeupStudents(query: string) {
    setMakeupSearch(query)
    if (query.length < 2) {
      setMakeupSearchResults([])
      return
    }
    setMakeupSearching(true)
    try {
      const res = await fetch(
        `/api/lessons/${lessonId}/makeup/search?q=${encodeURIComponent(query)}&groupId=${groupId || ""}`
      )
      if (res.ok) {
        const data = await res.json()
        setMakeupSearchResults(data)
      }
    } catch {
      // silently fail
    } finally {
      setMakeupSearching(false)
    }
  }

  // Makeup: add student
  async function addMakeupStudent(result: MakeupSearchResult) {
    setAddingMakeup(true)
    try {
      const res = await fetch(`/api/lessons/${lessonId}/makeup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: result.clientId,
          wardId: result.wardId,
          subscriptionId: result.subscriptionId,
        }),
      })
      if (res.ok) {
        setMakeupDialogOpen(false)
        setMakeupSearch("")
        setMakeupSearchResults([])
        router.refresh()
      } else {
        const err = await res.json()
        alert(err.error || "Ошибка при добавлении на отработку")
      }
    } catch {
      alert("Ошибка сети")
    } finally {
      setAddingMakeup(false)
    }
  }

  // Check if attendance type is "absent" (no charge, no instructor pay)
  function isAbsentType(attendanceTypeId: string): boolean {
    const type = attendanceTypes.find((t) => t.id === attendanceTypeId)
    return !!type && !type.chargesSubscription && !type.paysInstructor
  }

  // Summary calculations — include makeup students
  const markedStudents = allStudents.filter((s) => s.attendance)
  const unmarkedStudents = allStudents.filter((s) => !s.attendance)

  const typeCounts = attendanceTypes.map((t) => ({
    name: t.name,
    count: markedStudents.filter((s) => s.attendance?.attendanceTypeId === t.id).length,
  })).filter((t) => t.count > 0)

  const totalCharges = markedStudents.reduce(
    (sum, s) => sum + (s.attendance?.chargeAmount || 0),
    0
  )
  const totalInstructorPay =
    markedStudents.reduce(
      (sum, s) =>
        sum + (s.attendance?.instructorPayEnabled ? (s.attendance?.instructorPayAmount || 0) : 0),
      0
    ) +
    trialStudents.reduce(
      (sum, t) =>
        sum +
        (t.status === "attended" && t.instructorPayEnabled ? t.instructorPayAmount : 0),
      0
    )

  // Изменить статус пробного занятия (явка / не пришёл / отменено)
  async function updateTrialStatus(trial: TrialStudentData, newStatus: string) {
    if (!newStatus || newStatus === trial.status) return
    setLoadingTrialId(trial.trialId)
    try {
      const res = await fetch(`/api/trial-lessons/${trial.trialId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        if (newStatus === "cancelled") {
          // Запись на пробное снята — убираем строку из таблицы
          setTrialStudents((prev) => prev.filter((t) => t.trialId !== trial.trialId))
        } else {
          setTrialStudents((prev) =>
            prev.map((t) =>
              t.trialId === trial.trialId
                ? { ...t, status: newStatus as TrialStudentData["status"] }
                : t
            )
          )
        }
        router.refresh()
      }
    } catch {
      // silently fail
    } finally {
      setLoadingTrialId(null)
    }
  }

  // Прикинуть сумму ЗП за пробного на клиенте — для отображения до сохранения с сервера
  function estimateTrialPay(enabled: boolean): number {
    if (!enabled || !salaryRate) return 0
    if (salaryRate.scheme === "per_student" && salaryRate.ratePerStudent) {
      return salaryRate.ratePerStudent
    }
    if (salaryRate.scheme === "fixed_plus_per_student" && salaryRate.ratePerStudent) {
      return salaryRate.ratePerStudent
    }
    if (salaryRate.scheme === "per_lesson" && salaryRate.ratePerLesson) {
      return salaryRate.ratePerLesson
    }
    return 0
  }

  // Переключить чекбокс «Оплата инструктору» для пробного
  async function toggleTrialPay(trial: TrialStudentData) {
    const newEnabled = !trial.instructorPayEnabled
    setLoadingTrialId(trial.trialId)
    try {
      const res = await fetch(`/api/trial-lessons/${trial.trialId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructorPayEnabled: newEnabled }),
      })
      if (res.ok) {
        setTrialStudents((prev) =>
          prev.map((t) =>
            t.trialId === trial.trialId
              ? {
                  ...t,
                  instructorPayEnabled: newEnabled,
                  // оптимистично прикидываем сумму; точная придёт после router.refresh()
                  instructorPayAmount:
                    t.status === "attended" ? estimateTrialPay(newEnabled) : t.instructorPayAmount,
                }
              : t
          )
        )
        router.refresh()
      }
    } catch {
      // silently fail
    } finally {
      setLoadingTrialId(null)
    }
  }

  function renderTrialRow(trial: TrialStudentData) {
    const isLoading = loadingTrialId === trial.trialId
    const displayName = trial.wardName || trial.clientName

    return (
      <TableRow key={`trial-${trial.trialId}`}>
        <TableCell>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{displayName}</span>
              <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">
                пробное
              </Badge>
            </div>
            {trial.wardName && (
              <div className="text-xs text-muted-foreground">
                {trial.clientName}
              </div>
            )}
          </div>
        </TableCell>
        <TableCell>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Сохранение...
            </div>
          ) : (
            <Select
              value={trial.status}
              onValueChange={(val) => {
                if (val) updateTrialStatus(trial, val)
              }}
            >
              <SelectTrigger className="w-full">
                {TRIAL_STATUS_LABELS[trial.status] || trial.status}
              </SelectTrigger>
              <SelectContent>
                {TRIAL_STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </TableCell>
        <TableCell>
          <span className="text-muted-foreground">{"—"}</span>
        </TableCell>
        <TableCell className="text-right">
          <span className="text-muted-foreground">{"—"}</span>
        </TableCell>
        <TableCell className="text-right">
          {trial.status === "attended"
            ? formatMoney(
                trial.instructorPayEnabled ? trial.instructorPayAmount : 0
              )
            : <span className="text-muted-foreground">{"—"}</span>}
        </TableCell>
        <TableCell className="text-center">
          <div className="flex justify-center">
            <Checkbox
              checked={trial.instructorPayEnabled}
              onCheckedChange={() => toggleTrialPay(trial)}
              disabled={isLoading}
            />
          </div>
        </TableCell>
      </TableRow>
    )
  }

  function renderStudentRow(student: StudentData) {
    const isLoading = loadingStudentId === student.enrollmentId
    const displayName = student.wardName || student.clientName

    return (
      <TableRow key={student.enrollmentId}>
        <TableCell>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{displayName}</span>
              {student.isMakeup && (
                <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                  отработка
                </Badge>
              )}
            </div>
            {student.wardName && (
              <div className="text-xs text-muted-foreground">
                {student.clientName}
              </div>
            )}
          </div>
        </TableCell>
        <TableCell>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Сохранение...
            </div>
          ) : (
            <Select
              value={student.attendance?.attendanceTypeId || ""}
              onValueChange={(val) => {
                if (val) markAttendance(student, val)
              }}
            >
              <SelectTrigger className="w-full">
                {student.attendance?.attendanceTypeName || (
                  <span className="text-muted-foreground">Не отмечен</span>
                )}
              </SelectTrigger>
              <SelectContent>
                {attendanceTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </TableCell>
        <TableCell>
          {student.attendance &&
           isAbsentType(student.attendance.attendanceTypeId) &&
           absenceReasons.length > 0 ? (
            <Select
              value={student.attendance.absenceReasonId || ""}
              onValueChange={(val) =>
                saveAbsenceReason(student, val || null)
              }
            >
              <SelectTrigger className="w-full text-xs">
                {student.attendance.absenceReasonId
                  ? absenceReasons.find(
                      (r) => r.id === student.attendance?.absenceReasonId
                    )?.name || "\u2014"
                  : <span className="text-muted-foreground">Причина</span>}
              </SelectTrigger>
              <SelectContent>
                {absenceReasons.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-muted-foreground">{"\u2014"}</span>
          )}
        </TableCell>
        <TableCell className="text-right">
          {student.attendance
            ? formatMoney(student.attendance.chargeAmount)
            : <span className="text-muted-foreground">{"\u2014"}</span>
          }
        </TableCell>
        <TableCell className="text-right">
          {student.attendance
            ? formatMoney(
                student.attendance.instructorPayEnabled
                  ? student.attendance.instructorPayAmount
                  : 0
              )
            : <span className="text-muted-foreground">{"\u2014"}</span>
          }
        </TableCell>
        <TableCell className="text-center">
          {student.attendance ? (
            <div className="flex justify-center">
              <Checkbox
                checked={student.attendance.instructorPayEnabled}
                onCheckedChange={() => toggleInstructorPay(student)}
              />
            </div>
          ) : (
            <span className="text-muted-foreground">{"\u2014"}</span>
          )}
        </TableCell>
      </TableRow>
    )
  }

  return (
    <div className="space-y-6">
      {/* Substitute Instructor */}
      {instructors.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <UserCheck className="size-5 text-muted-foreground" />
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">Педагог группы</div>
                <div className="text-sm font-medium">{instructorName}</div>
              </div>
              {substituteId ? (
                <div className="flex items-center gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Замена</div>
                    <div className="text-sm font-medium text-orange-600 dark:text-orange-400">
                      {substituteName}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    title="Отменить замену"
                    disabled={savingSubstitute}
                    onClick={() => setSubstituteInstructor(null)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Select
                    value=""
                    onValueChange={(val) => {
                      if (val) setSubstituteInstructor(val)
                    }}
                  >
                    <SelectTrigger className="w-[200px]">
                      <span className="text-muted-foreground">
                        {savingSubstitute ? "Сохранение..." : "Назначить замену"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {instructors.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Topic & Homework */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Тема занятия</Label>
          <Textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onBlur={() => saveField("topic", topic)}
            placeholder="Тема занятия..."
            className="min-h-[60px]"
          />
          {savingTopic && (
            <span className="text-xs text-muted-foreground">Сохранение...</span>
          )}
        </div>
        <div className="space-y-2">
          <Label>Домашнее задание</Label>
          <Textarea
            value={homework}
            onChange={(e) => setHomework(e.target.value)}
            onBlur={() => saveField("homework", homework)}
            placeholder="Домашнее задание..."
            className="min-h-[60px]"
          />
          {savingHomework && (
            <span className="text-xs text-muted-foreground">Сохранение...</span>
          )}
        </div>
      </div>

      {/* Attendance section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Посещаемость ({markedStudents.length}/{allStudents.length})
            </CardTitle>
            <div className="flex items-center gap-2">
              {/* Makeup dialog */}
              <Dialog open={makeupDialogOpen} onOpenChange={setMakeupDialogOpen}>
                <DialogTrigger render={<Button size="sm" variant="outline" />}>
                    <UserPlus className="mr-2 size-4" />
                    Добавить на отработку
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>Добавить ученика на отработку</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Input
                        placeholder="Поиск по имени или фамилии..."
                        value={makeupSearch}
                        onChange={(e) => searchMakeupStudents(e.target.value)}
                        autoFocus
                      />
                    </div>
                    {makeupSearching && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                        <Loader2 className="size-4 animate-spin" />
                        Поиск...
                      </div>
                    )}
                    {!makeupSearching && makeupSearch.length >= 2 && makeupSearchResults.length === 0 && (
                      <div className="text-sm text-muted-foreground text-center py-4">
                        Ученики не найдены
                      </div>
                    )}
                    {makeupSearchResults.length > 0 && (
                      <div className="max-h-[300px] overflow-y-auto space-y-2">
                        {makeupSearchResults.map((result) => (
                          <div
                            key={`${result.clientId}-${result.wardId || ""}-${result.subscriptionId}`}
                            className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent"
                          >
                            <div>
                              <div className="font-medium text-sm">
                                {result.wardName || result.clientName}
                              </div>
                              {result.wardName && (
                                <div className="text-xs text-muted-foreground">
                                  {result.clientName}
                                </div>
                              )}
                              <div className="text-xs text-muted-foreground">
                                {result.subscriptionLabel} — баланс: {formatMoney(result.balance)}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              disabled={addingMakeup}
                              onClick={() => addMakeupStudent(result)}
                            >
                              {addingMakeup ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                "Добавить"
                              )}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>

              {presentType && (
                <Button
                  size="sm"
                  onClick={markAllPresent}
                  disabled={markingAll || unmarkedStudents.length === 0}
                >
                  {markingAll ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Отмечаем...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-2 size-4" />
                      Отметить всех — Явка
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {allStudents.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Users className="mx-auto size-10 opacity-50 mb-2" />
              <p>В группе нет зачисленных учеников</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Ученик</TableHead>
                  <TableHead className="w-[180px]">Тип дня</TableHead>
                  <TableHead className="w-[150px]">Причина</TableHead>
                  <TableHead className="w-[120px] text-right">Списание</TableHead>
                  <TableHead className="w-[120px] text-right">ЗП инструктора</TableHead>
                  <TableHead className="w-[80px] text-center">Оплата инструктору</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map(renderStudentRow)}
                {makeupStudents.length > 0 && makeupStudents.map(renderStudentRow)}
                {trialStudents.length > 0 && trialStudents.map(renderTrialRow)}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Summary */}
      {(markedStudents.length > 0 || trialStudents.length > 0) && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-6">
              {/* Type counts */}
              <div>
                <div className="text-xs text-muted-foreground mb-1">По типам</div>
                <div className="flex gap-3">
                  {typeCounts.map((tc) => (
                    <div key={tc.name} className="text-sm">
                      <span className="font-medium">{tc.name}:</span> {tc.count}
                    </div>
                  ))}
                  {unmarkedStudents.length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium">Не отмечено:</span> {unmarkedStudents.length}
                    </div>
                  )}
                  {makeupStudents.length > 0 && (
                    <div className="text-sm text-orange-600">
                      <span className="font-medium">Отработки:</span> {makeupStudents.length}
                    </div>
                  )}
                  {trialStudents.length > 0 && (
                    <div className="text-sm text-blue-600">
                      <span className="font-medium">Пробные:</span> {trialStudents.length}
                    </div>
                  )}
                </div>
              </div>

              {/* Totals */}
              <div className="ml-auto flex gap-6">
                <div>
                  <div className="text-xs text-muted-foreground">Списано</div>
                  <div className="text-sm font-bold">{formatMoney(totalCharges)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">ЗП инструктора</div>
                  <div className="text-sm font-bold">{formatMoney(totalInstructorPay)}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
