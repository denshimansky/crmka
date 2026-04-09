"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
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

interface StudentData {
  enrollmentId: string
  clientId: string
  clientName: string
  clientPhone: string | null
  wardId: string | null
  wardName: string | null
  subscriptionId: string | null
  lessonPrice: number
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

interface AttendanceTableProps {
  lessonId: string
  topic: string | null
  homework: string | null
  students: StudentData[]
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
  topic: initialTopic,
  homework: initialHomework,
  students: initialStudents,
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
  const [topic, setTopic] = useState(initialTopic || "")
  const [homework, setHomework] = useState(initialHomework || "")
  const [savingTopic, setSavingTopic] = useState(false)
  const [savingHomework, setSavingHomework] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [loadingStudentId, setLoadingStudentId] = useState<string | null>(null)
  const [substituteId, setSubstituteId] = useState<string | null>(initSubstituteId || null)
  const [substituteName, setSubstituteName] = useState<string | null>(initSubstituteName || null)
  const [savingSubstitute, setSavingSubstitute] = useState(false)

  const presentType = attendanceTypes.find((t) => t.code === "present")

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

          setStudents((prev) =>
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
          )
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
      setStudents((prev) =>
        prev.map((s) =>
          s.enrollmentId === student.enrollmentId && s.attendance
            ? { ...s, attendance: { ...s.attendance, absenceReasonId } }
            : s
        )
      )
    } catch {
      // silently fail
    }
  }

  // Check if attendance type is "absent" (no charge, no instructor pay)
  function isAbsentType(attendanceTypeId: string): boolean {
    const type = attendanceTypes.find((t) => t.id === attendanceTypeId)
    return !!type && !type.chargesSubscription && !type.paysInstructor
  }

  // Summary calculations
  const markedStudents = students.filter((s) => s.attendance)
  const unmarkedStudents = students.filter((s) => !s.attendance)

  const typeCounts = attendanceTypes.map((t) => ({
    name: t.name,
    count: markedStudents.filter((s) => s.attendance?.attendanceTypeId === t.id).length,
  })).filter((t) => t.count > 0)

  const totalCharges = markedStudents.reduce(
    (sum, s) => sum + (s.attendance?.chargeAmount || 0),
    0
  )
  const totalInstructorPay = markedStudents.reduce(
    (sum, s) => sum + (s.attendance?.instructorPayEnabled ? (s.attendance?.instructorPayAmount || 0) : 0),
    0
  )

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
              Посещаемость ({markedStudents.length}/{students.length})
            </CardTitle>
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
        </CardHeader>
        <CardContent>
          {students.length === 0 ? (
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
                {students.map((student) => {
                  const isLoading = loadingStudentId === student.enrollmentId
                  const displayName = student.wardName || student.clientName

                  return (
                    <TableRow key={student.enrollmentId}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{displayName}</div>
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
                                  )?.name || "—"
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
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {student.attendance
                          ? formatMoney(student.attendance.chargeAmount)
                          : <span className="text-muted-foreground">—</span>
                        }
                      </TableCell>
                      <TableCell className="text-right">
                        {student.attendance
                          ? formatMoney(
                              student.attendance.instructorPayEnabled
                                ? student.attendance.instructorPayAmount
                                : 0
                            )
                          : <span className="text-muted-foreground">—</span>
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
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Summary */}
      {markedStudents.length > 0 && (
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
