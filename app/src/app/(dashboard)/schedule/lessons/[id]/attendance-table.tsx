"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
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
import { AddStudentDialog } from "./add-student-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CheckCircle2, Loader2, Users, UserCheck, X } from "lucide-react"
import { StickyHScroll } from "@/components/sticky-h-scroll"
import { useRoleNames } from "@/components/role-names-provider"

interface MakeupResolvedInfo {
  attendanceId: string
  /** lessonId занятия, на котором отработка была проведена — клик ведёт сюда. */
  lessonId: string
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
  /** Разовое посещение (без зачисления в группу). Рендерим с бейджем
   *  «Разовое». При attendance=null это placeholder (isPending) — у такой
   *  строки есть кнопка «Убрать» для полного удаления записи. */
  isOneTime?: boolean
  /** Зачисление с paymentStatus='awaiting_payment' — родитель ещё не оплатил
   *  абонемент. Рендерим бейдж «Ожидаем оплату». Снимается автоматически при
   *  пополнении баланса (см. /api/payments). */
  awaitingPayment?: boolean
  /** Если пропуск этого занятия уже отработан в другом — здесь информация. */
  makeupResolved?: MakeupResolvedInfo | null
  /** Если стоит «Назначена отработка» — целевое будущее занятие. */
  scheduledMakeup?: ScheduledMakeupInfo | null
  /** Ф7: если эта строка — отработка ребёнка из другой группы, здесь данные
   *  исходного (пропущенного) занятия. Бейдж «Отработка за DD.MM», клик → L1. */
  makeupSource?: {
    lessonId: string
    date: string
    startTime: string
    directionName: string
    groupName: string
  } | null
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
  availableToAdmin?: boolean
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
}

// Отмены записи здесь нет: пробное переносят или удаляют вместе с заявкой
// на странице «Продажи» — из журнала заявка не должна откатываться в «Заявку».
const TRIAL_STATUS_OPTIONS = [
  { value: "scheduled", label: "Не отмечен" },
  { value: "attended", label: "Пришёл" },
  { value: "no_show", label: "Не пришёл" },
]

/** Тема занятия / домашнее задание: текст пишется кнопкой «Записать» (и,
 *  как раньше, автоматически при уходе фокуса), состояние записи видно явно —
 *  «есть незаписанные изменения» / «Записано» / ошибка с повтором. */
function LessonTextField({
  label,
  placeholder,
  initialValue,
  onSave,
}: {
  label: string
  placeholder: string
  initialValue: string | null
  onSave: (value: string | null) => Promise<boolean>
}) {
  const [value, setValue] = useState(initialValue || "")
  const [savedValue, setSavedValue] = useState((initialValue || "").trim())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  // Последний поставленный в очередь текст: blur перед кликом по кнопке уже
  // запускает запись — повторный запрос того же текста не шлём.
  const lastQueuedRef = useRef<string | null>(null)
  // PATCH'и сериализуются через очередь: два конкурентных запроса с разным
  // текстом сервер может применить в любом порядке.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  const pendingCountRef = useRef(0)

  const dirty = value.trim() !== savedValue

  async function save() {
    const trimmed = value.trim()
    if (trimmed === savedValue || lastQueuedRef.current === trimmed) return
    lastQueuedRef.current = trimmed
    pendingCountRef.current += 1
    setSaving(true)
    setSaveError(false)
    const run = queueRef.current.then(() => onSave(trimmed || null))
    queueRef.current = run.catch(() => {})
    const ok = await run
    if (lastQueuedRef.current === trimmed) lastQueuedRef.current = null
    pendingCountRef.current -= 1
    if (pendingCountRef.current === 0) setSaving(false)
    if (ok) {
      setSavedValue(trimmed)
      setJustSaved(true)
      setSaveError(false)
    } else {
      setSaveError(true)
    }
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setJustSaved(false)
        }}
        onBlur={save}
        placeholder={placeholder}
        className="min-h-[60px]"
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={save}
          disabled={saving || !dirty}
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Сохранение...
            </>
          ) : (
            "Записать"
          )}
        </Button>
        {saveError ? (
          <span className="text-xs text-destructive">
            Не удалось записать — нажмите «Записать» ещё раз
          </span>
        ) : !saving && dirty ? (
          <span className="text-xs text-muted-foreground">
            Есть незаписанные изменения
          </span>
        ) : !saving && justSaved ? (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircle2 className="size-3.5" />
            Записано
          </span>
        ) : null}
      </div>
    </div>
  )
}

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
  instructorName?: string
  substituteInstructorId?: string | null
  substituteInstructorName?: string | null
  instructors?: InstructorOption[]
  currentUserRole?: string
  /** Может ли пользователь открывать карточки клиентов/подопечных (/crm).
   *  Инструктор — нет: имена ростера показываем текстом, без ссылок в закрытый раздел. */
  canViewClients?: boolean
  /** Право «Добавление ученика на занятие» (матрица ролей) — показывать ли кнопку
   *  «Добавить ученика». Дефолт owner/manager/admin; инструктор/только-чтение — нет. */
  canAddStudent?: boolean
  /** Скрытая разовая группа (Group.isOneTime=true) — для модалки «Добавить ученика». */
  groupIsOneTime?: boolean
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
  instructorName,
  substituteInstructorId: initSubstituteId,
  substituteInstructorName: initSubstituteName,
  instructors = [],
  currentUserRole,
  canViewClients = true,
  canAddStudent = false,
  groupIsOneTime = false,
}: AttendanceTableProps) {
  const roleNames = useRoleNames()
  const router = useRouter()
  const [students, setStudents] = useState(initialStudents)
  const [makeupStudents, setMakeupStudents] = useState(initialMakeupStudents)
  const [trialStudents, setTrialStudents] = useState(initialTrialStudents)

  // Синхронизация локального state со свежими server-props после router.refresh().
  // Без этого useState(initialStudents) держит снимок с момента первого монтирования,
  // и добавление/удаление ученика не отражается, пока вручную не обновишь страницу.
  useEffect(() => {
    setStudents(initialStudents)
  }, [initialStudents])
  useEffect(() => {
    setMakeupStudents(initialMakeupStudents)
  }, [initialMakeupStudents])
  useEffect(() => {
    setTrialStudents(initialTrialStudents)
  }, [initialTrialStudents])
  const [loadingTrialId, setLoadingTrialId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  const [loadingStudentId, setLoadingStudentId] = useState<string | null>(null)
  const [substituteId, setSubstituteId] = useState<string | null>(initSubstituteId || null)
  const [substituteName, setSubstituteName] = useState<string | null>(initSubstituteName || null)
  const [savingSubstitute, setSavingSubstitute] = useState(false)
  const [scheduleMakeupFor, setScheduleMakeupFor] = useState<StudentData | null>(null)
  // Ф8/C6: подтверждение смены «Был» на «Не был» / «Не отмечен» на отработке.
  // Доступно только админ+, для них показываем модалку про ведомости ЗП.
  const [pendingMakeupChange, setPendingMakeupChange] = useState<
    | { student: StudentData; action: "no_show"; typeId: string }
    | { student: StudentData; action: "clear" }
    | null
  >(null)

  const presentType = attendanceTypes.find((t) => t.code === "present")
  const scheduledMakeupType = attendanceTypes.find((t) => t.code === "makeup_scheduled")

  /** Ф8/C6: ловушка для смены отметки «Был» на отработке — нужно подтверждение. */
  function isReducingMakeupAttendance(student: StudentData, newTypeCode: string | "clear"): boolean {
    if (!student.isMakeup) return false
    if (!student.attendance) return false
    if (student.attendance.attendanceTypeCode !== "present") return false
    if (Number(student.attendance.chargeAmount) <= 0) return false
    return newTypeCode === "no_show" || newTypeCode === "clear"
  }

  // All students combined (enrolled + makeup)
  const allStudents = [...students, ...makeupStudents]
  // Trial students are not in Attendance; «отмечен» = status != scheduled.
  const trialMarkedCount = trialStudents.filter((t) => t.status !== "scheduled").length
  const totalStudentsCount = allStudents.length + trialStudents.length
  const totalMarkedCount = allStudents.filter((s) => s.attendance).length + trialMarkedCount

  // Запись темы / домашнего задания (LessonTextField). Возвращает успех —
  // поле показывает ошибку и оставляет кнопку «Записать» для повтора.
  const saveLessonField = useCallback(
    async (field: "topic" | "homework", value: string | null): Promise<boolean> => {
      try {
        const res = await fetch(`/api/lessons/${lessonId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        })
        return res.ok
      } catch {
        return false
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
      } else {
        // Показываем причину отказа (напр. замок отчисленного/закрытого абонемента),
        // иначе снятие отметки «молча не срабатывает» и оператор не понимает почему.
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Не удалось снять отметку")
      }
    } catch {
      // silently fail
    } finally {
      setLoadingStudentId(null)
    }
  }

  // Полное удаление разового ученика с занятия (placeholder уходит совсем).
  async function removeOneTimeStudent(student: StudentData) {
    if (!confirm(`Убрать ${student.wardName || student.clientName} с занятия?`)) return
    setLoadingStudentId(student.enrollmentId)
    try {
      const res = await fetch(`/api/lessons/${lessonId}/attendance`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: student.clientId,
          wardId: student.wardId,
          purge: true,
        }),
      })
      if (res.ok) {
        setStudents((prev) => prev.filter((s) => s.enrollmentId !== student.enrollmentId))
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

    // Тип дня без начисления инструктору → галочка «Оплата инструктору»
    // снимается автоматически (сервер тоже нормализует).
    const markType = attendanceTypes.find((t) => t.id === attendanceTypeId)
    const payEnabled = markType?.paysInstructor === false ? false : instructorPayEnabled

    try {
      const res = await fetch(`/api/lessons/${lessonId}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: student.clientId,
          wardId: student.wardId,
          subscriptionId: student.subscriptionId,
          attendanceTypeId,
          instructorPayEnabled: payEnabled,
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
          if (attType.paysInstructor && payEnabled && salaryRate) {
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
                      instructorPayEnabled: payEnabled,
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
    // Тип без начисления инструктору — переключать нечего (чекбокс задизейблен).
    if (!typePaysInstructor(student.attendance.attendanceTypeId)) return
    const newEnabled = !student.attendance.instructorPayEnabled
    await markAttendance(student, student.attendance.attendanceTypeId, newEnabled)
  }

  // Есть ли у типа дня начисление инструктору (для неизвестного типа — true,
  // чтобы не блокировать чекбокс на исторических данных).
  function typePaysInstructor(attendanceTypeId: string): boolean {
    const type = attendanceTypes.find((t) => t.id === attendanceTypeId)
    return type ? type.paysInstructor : true
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

  // Изменить статус пробного занятия (явка / не пришёл)
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
        setTrialStudents((prev) =>
          prev.map((t) =>
            t.trialId === trial.trialId
              ? { ...t, status: newStatus as TrialStudentData["status"] }
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
              {canViewClients ? (
                <Link
                  href={`/crm/clients/${trial.clientId}`}
                  className="font-medium text-primary hover:underline"
                >
                  {displayName}
                </Link>
              ) : (
                <span className="font-medium">{displayName}</span>
              )}
              {canViewClients ? (
                <Link href={`/crm/clients/${trial.clientId}`} title="Открыть карточку лида">
                  <Badge
                    variant="outline"
                    className="text-xs text-blue-600 border-blue-300 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/30"
                  >
                    пробное
                  </Badge>
                </Link>
              ) : (
                <Badge
                  variant="outline"
                  className="text-xs text-blue-600 border-blue-300"
                >
                  пробное
                </Badge>
              )}
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
              {student.wardId && canViewClients ? (
                <Link
                  href={`/crm/wards/${student.wardId}`}
                  className="font-medium hover:underline"
                >
                  {displayName}
                </Link>
              ) : (
                <span className="font-medium">{displayName}</span>
              )}
              {student.isOneTime && (
                <Badge
                  variant="outline"
                  className="text-xs text-purple-700 dark:text-purple-300 border-purple-300"
                  title="Разовое посещение (без зачисления в группу)"
                >
                  Разовое
                </Badge>
              )}
              {student.awaitingPayment && (
                <Badge
                  variant="outline"
                  className="text-xs text-amber-700 dark:text-amber-300 border-amber-300"
                  title="Абонемент выписан, но ещё не оплачен"
                >
                  Ожидаем оплату
                </Badge>
              )}
              {/* Кнопка убрать разового — только для placeholder (Не отмечен). */}
              {student.isOneTime && !student.attendance && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-muted-foreground hover:text-destructive"
                  onClick={() => removeOneTimeStudent(student)}
                  disabled={loadingStudentId === student.enrollmentId}
                  title="Убрать с занятия"
                >
                  <X className="size-3" />
                </Button>
              )}
              {/* Бейдж «Отработка за DD.MM» — для отработок (виртуальных и отмеченных).
                  Клик → исходное (пропущенное) занятие. Если makeupSource не передан,
                  падаем на старый простой «отработка» (для совместимости). */}
              {student.isMakeup && student.makeupSource && (
                <Link
                  href={`/schedule/lessons/${student.makeupSource.lessonId}`}
                  title={`Отрабатывает занятие ${new Date(student.makeupSource.date).toLocaleDateString("ru-RU")} в ${student.makeupSource.startTime}, группа «${student.makeupSource.groupName}» (${student.makeupSource.directionName}). Кликните, чтобы открыть.`}
                >
                  <Badge
                    variant="outline"
                    className="text-xs text-orange-600 border-orange-300 cursor-pointer hover:bg-orange-50 dark:hover:bg-orange-950/30"
                  >
                    Отработка за {new Date(student.makeupSource.date).toLocaleDateString("ru-RU")}
                  </Badge>
                </Link>
              )}
              {student.isMakeup && !student.makeupSource && (
                <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                  отработка
                </Badge>
              )}
              {student.makeupResolved && (
                <Link
                  href={`/schedule/lessons/${student.makeupResolved.lessonId}`}
                  title={`Отработано ${new Date(student.makeupResolved.date).toLocaleDateString("ru-RU")} в группе «${student.makeupResolved.groupName}» (${student.makeupResolved.directionName}) в ${student.makeupResolved.startTime}. Кликните, чтобы открыть.`}
                >
                  <Badge
                    variant="outline"
                    className="text-xs text-emerald-700 dark:text-emerald-300 border-emerald-300 cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                  >
                    отработано {new Date(student.makeupResolved.date).toLocaleDateString("ru-RU")}
                  </Badge>
                </Link>
              )}
              {!student.makeupResolved && student.scheduledMakeup && (
                <Link
                  href={`/schedule/lessons/${student.scheduledMakeup.lessonId}`}
                  title={`Назначена отработка на ${new Date(student.scheduledMakeup.date).toLocaleDateString("ru-RU")} в группе «${student.scheduledMakeup.groupName}» (${student.scheduledMakeup.directionName}) в ${student.scheduledMakeup.startTime}. Кликните, чтобы открыть.`}
                >
                  <Badge
                    variant="outline"
                    className="text-xs text-amber-700 dark:text-amber-300 border-amber-300 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-950/30"
                  >
                    назначена отработка {new Date(student.scheduledMakeup.date).toLocaleDateString("ru-RU")}
                  </Badge>
                </Link>
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
              // Роль «только чтение» не отмечает (API тоже блокирует)
              disabled={currentUserRole === "readonly"}
              onValueChange={(val) => {
                if (!val) return
                if (val === "__unmarked__") {
                  if (!student.attendance) return
                  // Ф8/C6: снятие «Был» на отработке — модалка для админ+.
                  // Инструктору эта опция в выпадашке уже не показывается.
                  if (isReducingMakeupAttendance(student, "clear")) {
                    setPendingMakeupChange({ student, action: "clear" })
                    return
                  }
                  clearAttendance(student)
                  return
                }
                // «Назначена отработка» требует выбора целевого занятия
                if (scheduledMakeupType && val === scheduledMakeupType.id) {
                  setScheduleMakeupFor(student)
                  return
                }
                // Ф8/C6: смена «Был» → «Не был» на отработке требует подтверждения
                // (ЗП могла быть выплачена).
                const targetType = attendanceTypes.find((t) => t.id === val)
                if (targetType && isReducingMakeupAttendance(student, targetType.code)) {
                  setPendingMakeupChange({ student, action: "no_show", typeId: val })
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
                {/* «Не отмечен» (сброс) — для инструктора на уже отмеченной отработке прячем. */}
                {!isReducingMakeupAttendance(student, "clear") || currentUserRole !== "instructor" ? (
                  <SelectItem value="__unmarked__">
                    <span className="text-muted-foreground">Не отмечен</span>
                  </SelectItem>
                ) : null}
                {attendanceTypes
                  .filter((type) => {
                    // Ф7: для отработок (makeup-строк) разрешены только «Был» / «Не был».
                    if (student.isMakeup) {
                      if (type.code !== "present" && type.code !== "no_show") return false
                      // Ф8/C6: инструктор не может снять собственный «Был» на отработке
                      // → опция «Не был» прячется. Админ+ видит обе.
                      if (
                        type.code === "no_show" &&
                        currentUserRole === "instructor" &&
                        isReducingMakeupAttendance(student, "no_show")
                      ) {
                        return false
                      }
                      return true
                    }
                    // Внутренний тип «Отработка» ставится только программно (когда
                    // пропуск отработан) — вручную не выбирается никем. Прежний
                    // критерий «оба availableTo*=false» прятал тип и от владельца/
                    // управляющего, если у него сняли обе галочки доступности
                    // («Назначена отработка» пропадала у всех ролей — баг 02.07.2026);
                    // по справке управляющий и владелец видят все типы всегда.
                    if (type.code === "makeup") return false
                    if (currentUserRole === "instructor") return type.availableToInstructor === true
                    if (currentUserRole === "admin") return type.availableToAdmin !== false
                    return true
                  })
                  .map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
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
                checked={
                  student.attendance.instructorPayEnabled &&
                  typePaysInstructor(student.attendance.attendanceTypeId)
                }
                onCheckedChange={() => toggleInstructorPay(student)}
                disabled={!typePaysInstructor(student.attendance.attendanceTypeId)}
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
                <div className="text-xs text-muted-foreground">{roleNames.instructor} группы</div>
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
        <LessonTextField
          label="Тема занятия"
          placeholder="Тема занятия..."
          initialValue={initialTopic}
          onSave={(v) => saveLessonField("topic", v)}
        />
        <LessonTextField
          label="Домашнее задание"
          placeholder="Домашнее задание..."
          initialValue={initialHomework}
          onSave={(v) => saveLessonField("homework", v)}
        />
      </div>

      {/* Attendance section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-y-2">
            <CardTitle className="text-base">
              Посещаемость ({totalMarkedCount}/{totalStudentsCount})
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {canAddStudent && (
                <AddStudentDialog
                  lessonId={lessonId}
                  groupIsOneTime={groupIsOneTime}
                />
              )}

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
          {totalStudentsCount === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Users className="mx-auto size-10 opacity-50 mb-2" />
              <p>В группе нет зачисленных учеников</p>
            </div>
          ) : (
            <StickyHScroll>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Ученик</TableHead>
                    <TableHead className="w-[180px]">Тип дня</TableHead>
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
            </StickyHScroll>
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
                          {canViewClients ? (
                            <Link
                              href={`/crm/clients/${t.clientId}`}
                              className="hover:underline"
                              title="Открыть карточку лида"
                            >
                              {t.wardName || t.clientName}
                            </Link>
                          ) : (
                            <span>{t.wardName || t.clientName}</span>
                          )}
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

      {pendingMakeupChange && (
        <MakeupChangeWarningDialog
          student={pendingMakeupChange.student}
          newAction={pendingMakeupChange.action}
          onCancel={() => setPendingMakeupChange(null)}
          onConfirm={() => {
            const change = pendingMakeupChange
            setPendingMakeupChange(null)
            if (change.action === "clear") {
              clearAttendance(change.student)
            } else {
              markAttendance(change.student, change.typeId)
            }
          }}
        />
      )}
    </div>
  )
}

// ───── Модалка подтверждения смены «Был» → «Не был»/«Не отмечен» на отработке ─────

function MakeupChangeWarningDialog({
  student,
  newAction,
  onCancel,
  onConfirm,
}: {
  student: StudentData
  newAction: "no_show" | "clear"
  onCancel: () => void
  onConfirm: () => void
}) {
  const displayName = student.wardName || student.clientName
  const newLabel = newAction === "clear" ? "Не отмечен" : "Не был"
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-card shadow-lg">
        <div className="border-b p-4">
          <div className="text-base font-semibold">Снять отметку «Был» на отработке?</div>
          <div className="text-sm text-muted-foreground mt-0.5">
            {displayName} → {newLabel}
          </div>
        </div>

        <div className="space-y-3 p-4 text-sm">
          <div className="rounded-md bg-amber-100 px-3 py-2 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
            <strong>Внимание:</strong> ЗП за это занятие могла быть уже выплачена инструктору.
            После изменения проверьте ведомости — возможно, потребуется ручная корректировка.
          </div>
          <div className="text-muted-foreground">
            Со списания с абонемента исходной группы откатится автоматически. Связь с
            пропущенным занятием сохранится — администратор может переназначить отработку.
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t p-3">
          <Button variant="outline" onClick={onCancel}>Отмена</Button>
          <Button variant="destructive" onClick={onConfirm}>
            Снять отметку
          </Button>
        </div>
      </div>
    </div>
  )
}

// ───── Модалка выбора целевого занятия для «Назначена отработка» ─────

interface LessonOption {
  id: string
  date: string
  startTime: string
  durationMinutes: number
  group: { name: string; direction: { id: string; name: string }; room: { name: string } | null }
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
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [branchId, setBranchId] = useState<string>("")
  const [directionId, setDirectionId] = useState<string>("")
  // Все занятия выбранной даты+филиала (без фильтра направления) — из них
  // строим список доступных направлений и отфильтрованный по направлению список.
  const [dayLessons, setDayLessons] = useState<LessonOption[] | null>(null)
  const [loadingDay, setLoadingDay] = useState(false)
  const [dayError, setDayError] = useState<string | null>(null)
  // Занятия, показанные после нажатия «Показать занятия» (уже с фильтром направления).
  const [lessons, setLessons] = useState<LessonOption[] | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)

  const displayName = student.wardName || student.clientName

  // Филиалы подгружаем один раз при открытии модалки.
  useEffect(() => {
    let cancelled = false
    fetch("/api/branches")
      .then((r) => (r.ok ? r.json() : []))
      .then((bs: Array<{ id: string; name: string }>) => {
        if (cancelled) return
        if (Array.isArray(bs)) setBranches(bs.map((b) => ({ id: b.id, name: b.name })))
      })
      .catch(() => { /* ignore — оператор увидит пустой селект филиалов */ })
    return () => { cancelled = true }
  }, [])

  // При выбранных дате и филиале подгружаем все занятия этого дня в филиале —
  // из них формируется список направлений (показываем только те, по которым
  // реально есть занятия). Смена даты/филиала перезапускает загрузку.
  useEffect(() => {
    setDirectionId("")
    setLessons(null)
    setTargetId(null)
    setDayError(null)
    if (!date || !branchId) {
      setDayLessons(null)
      return
    }
    let cancelled = false
    setLoadingDay(true)
    const params = new URLSearchParams({ date, excludeId: excludeLessonId, branchId })
    fetch(`/api/lessons?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}))
          throw new Error(data.error || "Не удалось загрузить занятия")
        }
        return r.json()
      })
      .then((ls: LessonOption[]) => {
        if (cancelled) return
        setDayLessons(Array.isArray(ls) ? ls : [])
      })
      .catch((e: Error) => {
        if (cancelled) return
        setDayError(e.message || "Ошибка сети")
        setDayLessons([])
      })
      .finally(() => {
        if (!cancelled) setLoadingDay(false)
      })
    return () => { cancelled = true }
  }, [date, branchId, excludeLessonId])

  // Уникальные направления, по которым есть занятия в выбранную дату+филиал.
  const directions = useMemo(() => {
    if (!dayLessons) return []
    const map = new Map<string, string>()
    for (const l of dayLessons) map.set(l.group.direction.id, l.group.direction.name)
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "ru")
    )
  }, [dayLessons])

  // Смена направления сбрасывает показанный список — нужно снова нажать «Показать занятия».
  useEffect(() => {
    setLessons(null)
    setTargetId(null)
  }, [directionId])

  const loadLessons = useCallback(() => {
    if (!dayLessons || !directionId) return
    setLessons(dayLessons.filter((l) => l.group.direction.id === directionId))
    setTargetId(null)
  }, [dayLessons, directionId])

  const canSearch = !!directionId && !loadingDay
  const directionDisabled = !date || !branchId || loadingDay || directions.length === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-card shadow-lg">
        <div className="border-b p-4">
          <div className="text-base font-semibold">Назначить отработку</div>
          <div className="text-sm text-muted-foreground mt-0.5">
            {displayName} — выберите дату, филиал и направление, затем нажмите «Показать занятия».
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
          </div>

          <div className="space-y-1.5">
            <Label>Филиал</Label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="h-9 w-full rounded border bg-background px-3 text-sm"
            >
              <option value="">— выберите филиал —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Направление</Label>
            <select
              value={directionId}
              onChange={(e) => setDirectionId(e.target.value)}
              disabled={directionDisabled}
              className="h-9 w-full rounded border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">
                {!date || !branchId
                  ? "— сначала выберите дату и филиал —"
                  : loadingDay
                    ? "Загрузка направлений…"
                    : directions.length === 0
                      ? "— в эту дату нет занятий —"
                      : "— выберите направление —"}
              </option>
              {directions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            {date && branchId && !loadingDay && directions.length === 0 && !dayError && (
              <p className="text-xs text-muted-foreground">
                В выбранную дату в этом филиале занятий нет — выберите другую дату или филиал.
              </p>
            )}
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={loadLessons}
            disabled={!canSearch}
          >
            {loadingDay ? "Загрузка..." : "Показать занятия"}
          </Button>

          {dayError && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {dayError}
            </div>
          )}

          {lessons !== null && (
            lessons.length === 0 ? (
              <div className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                В эту дату нет занятий по выбранному филиалу и направлению.
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
