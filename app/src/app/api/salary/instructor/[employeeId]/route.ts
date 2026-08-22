import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { buildInstructorSalaryDetail, type AttendanceInput } from "@/lib/salary/instructor-detail"
import { kindOfDirection } from "@/lib/salary/kind-split"
import { okladForPeriod } from "@/lib/salary/oklad-for-period"
import { computePriorPieceBalances } from "@/lib/salary/prior-piece-balance"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { employeeId } = await params
  const tenantId = session.user.tenantId
  const role = (session.user as any).role as string

  // Сотрудник видит только свою детализацию; владелец и управляющий — всех
  const isOwn = session.user.employeeId === employeeId
  const canSeeAll = role === "owner" || role === "manager"
  if (!isOwn && !canSeeAll) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }
  const canPay = role === "owner" || role === "manager"

  const { searchParams } = new URL(req.url)
  const periodYear = Number(searchParams.get("periodYear")) || new Date().getFullYear()
  const periodMonth = Number(searchParams.get("periodMonth")) || new Date().getMonth() + 1
  const monthStart = new Date(Date.UTC(periodYear, periodMonth - 1, 1))
  const monthEnd = new Date(Date.UTC(periodYear, periodMonth, 0, 23, 59, 59, 999))

  const employee = await db.employee.findFirst({
    where: { id: employeeId, tenantId, deletedAt: null },
    select: {
      id: true, firstName: true, lastName: true, role: true,
      monthlySalary: true, okladFrom: true, defaultDirectionId: true,
      defaultDirection: { select: { name: true } },
    },
  })
  if (!employee) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })

  const [attendances, adjustments, paymentItems, accounts, periodLocked] = await Promise.all([
    db.attendance.findMany({
      where: {
        tenantId,
        instructorPayEnabled: true,
        lesson: {
          date: { gte: monthStart, lte: monthEnd },
          OR: [
            { substituteInstructorId: employeeId },
            { substituteInstructorId: null, instructorId: employeeId },
          ],
        },
      },
      select: {
        instructorPayAmount: true,
        attendanceType: { select: { name: true } },
        lesson: {
          select: {
            id: true, date: true,
            group: { select: { name: true, directionId: true, direction: { select: { name: true } } } },
          },
        },
      },
    }),
    db.salaryAdjustment.findMany({
      where: { tenantId, employeeId, periodYear, periodMonth },
      select: { id: true, type: true, amount: true, directionId: true, comment: true, createdAt: true, direction: { select: { name: true } } },
    }),
    db.salaryPaymentItem.findMany({
      where: { tenantId, employeeId, salaryPayment: { periodYear, periodMonth } },
      select: { directionId: true, amount: true, direction: { select: { name: true } } },
    }),
    db.financialAccount.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
    isPeriodLocked(tenantId, monthStart, role),
  ])

  const attInput: AttendanceInput[] = attendances.map((a) => ({
    lessonId: a.lesson.id,
    date: a.lesson.date,
    groupName: a.lesson.group.name,
    directionId: a.lesson.group.directionId,
    directionName: a.lesson.group.direction.name,
    typeName: a.attendanceType.name,
    instructorPayAmount: Number(a.instructorPayAmount),
  }))

  // Тип карточки: oklad-вид (только оклад) или piece-вид (только сделка). Оклад =
  // «без направления» (см. lib/salary/kind-split). kind из ссылки; без него —
  // «Оклады» для чистого окладника (есть оклад, нет сделки), иначе «Сдельная».
  // Оклад за выбранный месяц с учётом даты начала (okladFrom) и пропорции неполного
  // первого месяца. hasOklad — окладник ли он В ЭТОМ месяце (0 до даты начала).
  const okladThisPeriod = okladForPeriod({
    monthlySalary: employee.monthlySalary != null ? Number(employee.monthlySalary) : 0,
    okladFrom: employee.okladFrom,
    periodYear,
    periodMonth,
  })
  const hasOklad = okladThisPeriod > 0
  const pieceAccruedTotal = attInput.reduce((s, a) => s + a.instructorPayAmount, 0)
  const kindParam = searchParams.get("kind")
  const kind: "piece" | "salary" =
    kindParam === "salary" ? "salary"
      : kindParam === "piece" ? "piece"
        : hasOklad && pieceAccruedTotal === 0 ? "salary" : "piece"

  const okladName = employee.defaultDirection?.name
    ? `Оклад — ${employee.defaultDirection.name}`
    : "Оклад без направления"

  const detail = kind === "salary"
    ? buildInstructorSalaryDetail({
        // Окладный вид: одна строка оклада + окладные (без направления) премии/штрафы.
        attendances: [],
        adjustments: adjustments
          .filter((a) => kindOfDirection(a.directionId, hasOklad) === "salary")
          .map((a) => ({ id: a.id, type: a.type as "bonus" | "penalty", amount: Number(a.amount), comment: a.comment, createdAt: a.createdAt })),
        paymentItems: paymentItems
          .filter((p) => kindOfDirection(p.directionId, hasOklad) === "salary")
          .map((p) => ({ directionId: p.directionId, amount: Number(p.amount), directionName: p.direction?.name ?? null })),
        salaried: hasOklad
          ? {
              monthlySalary: okladThisPeriod,
              defaultDirectionId: employee.defaultDirectionId,
              defaultDirectionName: okladName,
            }
          : null,
      })
    : buildInstructorSalaryDetail({
        // Сдельный вид: направления занятий; направленные премии складываются в свои
        // строки, ненаправленные (только у чистого сдельщика) — строкой «Премии − штрафы».
        attendances: attInput,
        adjustments: adjustments
          .filter((a) => kindOfDirection(a.directionId, hasOklad) === "piece" && a.directionId == null)
          .map((a) => ({ id: a.id, type: a.type as "bonus" | "penalty", amount: Number(a.amount), comment: a.comment, createdAt: a.createdAt })),
        paymentItems: paymentItems
          .filter((p) => kindOfDirection(p.directionId, hasOklad) === "piece")
          .map((p) => ({ directionId: p.directionId, amount: Number(p.amount), directionName: p.direction?.name ?? null })),
        salaried: null,
        directionAdjustments: adjustments
          .filter((a) => a.directionId != null && kindOfDirection(a.directionId, hasOklad) === "piece")
          .map((a) => ({
            directionId: a.directionId as string,
            directionName: a.direction?.name ?? "Направление",
            type: a.type as "bonus" | "penalty",
            amount: Number(a.amount),
          })),
      })

  // «Доначислено» — накопленный сделочный остаток прошлых периодов (только для
  // сделочной карточки; для окладной он не применим). topDirectionId нужен позиции
  // выплаты «доначисления», чтобы у совместителя она классифицировалась как сделка.
  let priorPieceBalance = 0
  let priorTopDirectionId: string | null = null
  if (kind === "piece") {
    const priorMap = await computePriorPieceBalances(db, tenantId, periodYear, periodMonth, { employeeIds: [employeeId] })
    const prior = priorMap.get(employeeId)
    priorPieceBalance = prior?.balance ?? 0
    priorTopDirectionId = prior?.topDirectionId ?? null
  }

  return NextResponse.json({
    employee: {
      id: employee.id,
      name: [employee.lastName, employee.firstName].filter(Boolean).join(" ").trim() || "Без имени",
      role: employee.role,
    },
    kind,
    hasOklad,
    defaultDirectionId: employee.defaultDirectionId,
    periodYear,
    periodMonth,
    canPay,
    periodLocked,
    accounts,
    priorPieceBalance,
    priorTopDirectionId,
    ...detail,
  })
}
