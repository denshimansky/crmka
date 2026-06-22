import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { buildInstructorSalaryDetail, type AttendanceInput } from "@/lib/salary/instructor-detail"

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
      monthlySalary: true, defaultDirectionId: true,
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
      select: { type: true, amount: true },
    }),
    db.salaryPaymentItem.findMany({
      where: { tenantId, employeeId, salaryPayment: { periodYear, periodMonth } },
      select: { directionId: true, amount: true },
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

  const detail = buildInstructorSalaryDetail({
    attendances: attInput,
    adjustments: adjustments.map((a) => ({ type: a.type as "bonus" | "penalty", amount: Number(a.amount) })),
    paymentItems: paymentItems.map((p) => ({ directionId: p.directionId, amount: Number(p.amount) })),
    salaried: employee.monthlySalary && Number(employee.monthlySalary) > 0
      ? {
          monthlySalary: Number(employee.monthlySalary),
          defaultDirectionId: employee.defaultDirectionId,
          defaultDirectionName: employee.defaultDirection?.name ?? "Без направления",
        }
      : null,
  })

  return NextResponse.json({
    employee: {
      id: employee.id,
      name: [employee.lastName, employee.firstName].filter(Boolean).join(" ").trim() || "Без имени",
      role: employee.role,
    },
    periodYear,
    periodMonth,
    canPay,
    periodLocked,
    accounts,
    ...detail,
  })
}
