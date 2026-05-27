"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { AddMakeupDialog } from "./add-makeup-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CheckCircle2, Loader2, Users, UserCheck, X } from "lucide-react"

interface AbsenceReasonData {
  id: string
  name: string
}

interface MakeupResolvedInfo {
  attendanceId: string
  date: string
  startTime: string
  directionName: string
  groupName: string
}

interface ScheduledMakeupInfo {
  lessonId: string
  date: string
  startTime: string
  directionName: string
  groupName: string
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
  /** Если пропуск этого занятия уже отработан в другом — здесь информация. */
  makeupResolved?: MakeupResolvedInfo | null
  /** Если стоит «Назначена отработка» — целевое будущее занятие. */
  scheduledMakeup?: ScheduledMakeupInfo | null
  attendance: {
    id: string
    attendanceTypeId: string
    attendanceTypeName: string
    attendanceTypeCode: string
    chargeAmount: number
    instructorPayAmount: number
    instructorPayEnabled: boolean
    absenceReasonId?: string | null
    scheduledMakeupLessonId?: string | null
  } | null
}

interface AttendanceTypeData {
  id: string
  name: string
  code: string
  chargesSubscription: boolean
  paysInstructor: boolean
  availableToInstructor?: boolean
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

interface AttendanceTableProps {
  lessonId: string
  lessonDateISO: string
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
  currentUserRole?: string
}

function formatMoney(amount: number): string {
  if (amount === 0) return "0 \u20BD"
  return new Intl.NumberFormat("ru-RU").format(amount) + " \u20BD"
}

export function AttendanceTable({
  lessonId,
  lessonDateISO,
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
  currentUserRole,
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
  const [scheduleMakeupFor, setScheduleMakeupFor] = useState<StudentData | null>(null)

  const presentType = attendanceTypes.find((t) => t.code === "present")
  const scheduledMakeupType = attendanceTypes.find((t) => t.code === "makeup_scheduled")

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

  // Сброс отметки — возврат в «Не отмечен»
  async function clearAttendance(student: StudentData) {
    if (!student.attendance) return
    setLoadingStudentId(student.enrollmentId)
    try {
      // attendanceId должен быть UUID; если по какой-то причине его нет (старая
      // оптимистичная запись без свежего ответа сервера) — fallback на ученика.
      const isUuid = /^[0-9a-f-]{36}$/i.test(student.attendance.id || "")
      const payload = isUuid
        ? { attendanceId: student.attendance.id }
        : { clientId: student.clientId, wardId: student.wardId }
      const res = await fetch(`/api/lessons/${lessonId}/attendance`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const updateFn = (prev: StudentData[]) =>
          prev.map((s) =>
            s.enrollmentId === student.enrollmentId ? { ...s, attendance: null } : s
          )
        if (student.isMakeup) {
          // Отработки удаляются из таблицы — они исчезают вместе с Attendance
          setMakeupStudents((prev) => prev.filter((s) => s.enrollmentId !== student.enrollmentId))
        } else {
          setStudents(updateFn)
        }
        router.refresh()
      }
    } catch {
      // silently fail
    } finally {
      setLoadingStudentId(null)
    }
  }

  // Mark single student
  async function markAttendance(
    student: StudentData,
    attendanceTypeId: string,
    instructorPayEnabled: boolean = true,
    scheduledMakeupLessonId: string | null = null
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
          scheduledMakeupLessonId,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Не удалось сохранить отметку")
        return
      }

      {
        // Берём настоящий id из ответа сервера, чтобы потом можно было
        // корректно сделать DELETE (сброс отметки) до router.refresh().
        const created: { id?: string } = await res.json().catch(() => ({}))
        router.refresh()

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
                      id: created.id || s.attendance?.id || "",
                      attendanceTypeId,
                      attendanceTypeName: attType.name,
                      attendanceTypeCode: attType.code,
                      chargeAmount,
                      instructorPayAmount,
                      instructorPayEnabled,
                      scheduledMakeupLessonId,
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
        // Достаём реальные id отметок из ответа, чтобы их можно было сбросить
        // через DELETE до того, как router.refresh() подтянет свежие данные.
        const payload: { attendances?: { id: string; clientId: string; wardId: string | null }[] } =
          await res.json().catch(() => ({}))
        const byKey = new Map(
          (payload.attendances || []).map((a) => [`${a.clientId}|${a.wardId || ""}`, a.id])
        )
        router.refresh()
        const makeupType = attendanceTypes.find((t) => t.code === "makeup")
        // Optimistic update
        setStudents((prev) =>
          prev.map((s) => {
            // Если этот пропуск уже отработан в другой группе — сервер ставит
            // тип «Отработка» без списания; отражаем то же в UI оптимистично.
            const useType = s.makeupResolved && makeupType ? makeupType : presentType
            const chargeAmount = useType.chargesSubscription ? s.lessonPrice : 0
            let instructorPayAmount = 0
            if (useType.paysInstructor && salaryRate) {
              if (salaryRate.scheme === "per_student" && salaryRate.ratePerStudent) {
                instructorPayAmount = salaryRate.ratePerStudent
              }
            }
            const realId =
              byKey.get(`${s.clientId}|${s.wardId || ""}`) || s.attendance?.id || ""
            return {
              ...s,
              attendance: {
                id: realId,
                attendanceTypeId: useType.id,
                attendanceTypeName: useType.name,
                attendanceTypeCode: useType.code,
                chargeAmount,
                instructorPayAmount,
                instructorPayEnabled: useType.paysInstructor,
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
              <Link
                href={`/crm/clients/${trial.clientId}`}
                className="font-medium text-primary hover:underline"
              >
                {displayName}
              </Link>
              <Link href={`/crm/clients/${trial.clientId}`} title="Открыть карточку лида">
                <Badge
                  variant="outline"
                  className="text-xs text-blue-600 border-blue-300 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/30"
                >
                  пробное
                </Badge>
              </Link>
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
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{displayName}</span>
              {student.isMakeup && (
                <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                  отработка
                </Badge>
              )}
              {student.makeupResolved && (
                <Badge
                  variant="outline"
                  className="text-xs text-emerald-700 dark:text-emerald-300 border-emerald-300"
                  title={`Отработано ${new Date(student.makeupResolved.date).toLocaleDateString("ru-RU")} в группе «${student.makeupResolved.groupName}» (${student.makeupResolved.directionName}) в ${student.makeupResolved.startTime}`}
                >
                  отработано {new Date(student.makeupResolved.date).toLocaleDateString("ru-RU")}
                </Badge>
              )}
              {!student.makeupResolved && student.scheduledMakeup && (
                <Badge
                  variant="outline"
                  className="text-xs text-amber-700 dark:text-amber-300 border-amber-300"
                  title={`Назначена отработка на ${new Date(student.scheduledMakeup.date).toLocaleDateString("ru-RU")} в группе «${student.scheduledMakeup.groupName}» (${student.scheduledMakeup.directionName}) в ${student.scheduledMakeup.startTime}`}
                >
                  назначена отработка {new Date(student.scheduledMakeup.date).toLocaleDateString("ru-RU")}
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
              value={student.attendance?.attendanceTypeId || "__unmarked__"}
              onValueChange={(val) => {
                if (!val) return
                if (val === "__unmarked__") {
                  if (student.attendance) clearAttendance(student)
                  return
                }
                // «Назначена отработка» требует выбора целевого занятия
                if (scheduledMakeupType && val === scheduledMakeupType.id) {
                  setScheduleMakeupFor(student)
                  return
                }
                markAttendance(student, val)
              }}
            >
              <SelectTrigger className="w-full">
                {student.attendance?.attendanceTypeName || (
                  <span className="text-muted-foreground">Не отмечен</span>
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__unmarked__">
                  <span className="text-muted-foreground">Не отмечен</span>
                </SelectItem>
                {attendanceTypes
                  .filter((type) =>
                    currentUserRole === "instructor"
                      ? type.availableToInstructor === true
                      : true,
                  )
                  .map((type) => (
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
              <AddMakeupDialog lessonId={lessonId} lessonDateISO={lessonDateISO} />

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
                    <div className="text-sm text-blue-600 flex flex-wrap items-center gap-1">
                      <span className="font-medium">Пробные:</span>
                      {trialStudents.map((t, i) => (
                        <span key={t.trialId} className="inline-flex items-center">
                          <Link
                            href={`/crm/clients/${t.clientId}`}
                            className="hover:underline"
                            title="Открыть карточку лида"
                          >
                            {t.wardName || t.clientName}
                          </Link>
                          {i < trialStudents.length - 1 && (
                            <span className="ml-1 text-blue-600/70">,</span>
                          )}
                        </span>
                      ))}
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

      {scheduleMakeupFor && scheduledMakeupType && (
        <ScheduleMakeupDialog
          student={scheduleMakeupFor}
          excludeLessonId={lessonId}
          defaultDate={lessonDateISO}
          onClose={() => setScheduleMakeupFor(null)}
          onConfirm={(targetLessonId) => {
            const s = scheduleMakeupFor
            setScheduleMakeupFor(null)
            markAttendance(s, scheduledMakeupType.id, true, targetLessonId)
          }}
        />
      )}
    </div>
  )
}

// ───── Модалка выбора целевого занятия для «Назначена отработка» ─────

interface LessonOption {
  id: string
  date: string
  startTime: string
  durationMinutes: number
  group: { name: string; direction: { name: string }; room: { name: string } | null }
  instructor: { firstName: string | null; lastName: string | null }
  substituteInstructor: { firstName: string | null; lastName: string | null } | null
}

function ScheduleMakeupDialog({
  student,
  excludeLessonId,
  defaultDate,
  onClose,
  onConfirm,
}: {
  student: StudentData
  excludeLessonId: string
  defaultDate: string
  onClose: () => void
  onConfirm: (targetLessonId: string) => void
}) {
  const [date, setDate] = useState(defaultDate)
  const [lessons, setLessons] = useState<LessonOption[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const displayName = student.wardName || student.clientName

  const loadLessons = useCallback(async (d: string) => {
    setLoading(true)
    setError(null)
    setTargetId(null)
    try {
      const res = await fetch(
        `/api/lessons?date=${encodeURIComponent(d)}&excludeId=${encodeURIComponent(excludeLessonId)}`,
      )
      if (res.ok) {
        setLessons(await res.json())
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось загрузить занятия")
        setLessons([])
      }
    } catch {
      setError("Ошибка сети")
      setLessons([])
    } finally {
      setLoading(false)
    }
  }, [excludeLessonId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-card shadow-lg">
        <div className="border-b p-4">
          <div className="text-base font-semibold">Назначить отработку</div>
          <div className="text-sm text-muted-foreground mt-0.5">
            {displayName} — выберите дату и занятие, на котором ребёнок будет отрабатывать пропуск.
            Списание пройдёт по стоимости текущего занятия (с абонемента исходной группы).
          </div>
        </div>

        <div className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label>Дата</Label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 w-full rounded border bg-background px-3 text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadLessons(date)}
              disabled={!date || loading}
            >
              {loading ? "Загрузка..." : "Показать занятия"}
            </Button>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {lessons !== null && (
            lessons.length === 0 ? (
              <div className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                В эту дату нет занятий.
              </div>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto rounded border p-2">
                {lessons.map((l) => {
                  const instr = l.substituteInstructor || l.instructor
                  const instrName = [instr.lastName, instr.firstName].filter(Boolean).join(" ")
                  return (
                    <label
                      key={l.id}
                      className={`flex cursor-pointer items-center gap-2 rounded p-2 text-sm hover:bg-muted/50 ${
                        targetId === l.id ? "bg-muted" : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="targetLesson"
                        checked={targetId === l.id}
                        onChange={() => setTargetId(l.id)}
                      />
                      <div className="flex-1">
                        <div className="font-medium">
                          {l.startTime} — {l.group.direction.name} ({l.group.name})
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {instrName}
                          {l.group.room && ` · ${l.group.room.name}`}
                          {` · ${l.durationMinutes} мин`}
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            )
          )}
        </div>

        <div className="flex justify-end gap-2 border-t p-3">
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button
            disabled={!targetId}
            onClick={() => targetId && onConfirm(targetId)}
          >
            Назначить
          </Button>
        </div>
      </div>
    </div>
  )
}
