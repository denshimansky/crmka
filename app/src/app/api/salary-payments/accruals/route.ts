import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requirePermission } from "@/lib/api-permissions"

/**
 * GET /api/salary-payments/accruals?periodYear&periodMonth
 *
 * Возвращает по каждому сотруднику начисление за период, разнесённое по направлениям —
 * для автозаполнения документа выплаты ЗП.
 *
 * Источники:
 *   1. Преподаватели → агрегат `Attendance.instructorPayAmount` за период,
 *      сгруппирован по (employeeId, directionId) — берём с учётом подмены.
 *   2. Окладники → `Employee.monthlySalary` (одна строка с defaultDirectionId).
 *   3. Корректировки → суммируются как `bonus` / `penalty` без направления.
 *   4. `alreadyPaid` → `SalaryPaymentItem.amount` за тот же период.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission("finance.salary")
  if (!guard.ok) return guard.response
  const session = guard.session
  const tenantId = session.user.tenantId

  const { searchParams } = new URL(req.url)
  const periodYear = Number(searchParams.get("periodYear")) || new Date().getFullYear()
  const periodMonth = Number(searchParams.get("periodMonth")) || new Date().getMonth() + 1

  const monthStart = new Date(Date.UTC(periodYear, periodMonth - 1, 1))
  const monthEnd = new Date(Date.UTC(periodYear, periodMonth, 0, 23, 59, 59, 999))

  const [employees, attendances, adjustments, paymentItems] = await Promise.all([
    db.employee.findMany({
      where: { tenantId, deletedAt: null, isActive: true, role: { not: "readonly" } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        monthlySalary: true,
        defaultDirectionId: true,
        defaultDirection: { select: { id: true, name: true } },
      },
      orderBy: { lastName: "asc" },
    }),
    db.attendance.findMany({
      where: {
        tenantId,
        lesson: { date: { gte: monthStart, lte: monthEnd } },
        instructorPayEnabled: true,
      },
      select: {
        instructorPayAmount: true,
        lesson: {
          select: {
            instructorId: true,
            substituteInstructorId: true,
            group: { select: { directionId: true, direction: { select: { name: true } } } },
          },
        },
      },
    }),
    db.salaryAdjustment.findMany({
      where: { tenantId, periodYear, periodMonth },
      select: { employeeId: true, type: true, amount: true },
    }),
    db.salaryPaymentItem.findMany({
      where: {
        tenantId,
        salaryPayment: { periodYear, periodMonth },
      },
      select: { employeeId: true, amount: true },
    }),
  ])

  // === Начисления преподавателей ===
  type AccrualPerDir = { directionId: string | null; directionName: string; amount: number }
  const accrualsByEmployee = new Map<string, Map<string, AccrualPerDir>>()

  for (const a of attendances) {
    const empId = a.lesson.substituteInstructorId || a.lesson.instructorId
    if (!empId) continue
    const dirId = a.lesson.group.directionId
    const dirName = a.lesson.group.direction.name
    if (!accrualsByEmployee.has(empId)) accrualsByEmployee.set(empId, new Map())
    const m = accrualsByEmployee.get(empId)!
    const key = dirId
    const prev = m.get(key) || { directionId: dirId, directionName: dirName, amount: 0 }
    prev.amount += Number(a.instructorPayAmount)
    m.set(key, prev)
  }

  // === Окладники ===
  for (const emp of employees) {
    const ms = emp.monthlySalary ? Number(emp.monthlySalary) : 0
    if (ms <= 0) continue
    const dirId = emp.defaultDirectionId ?? null
    const dirName = emp.defaultDirection?.name ?? "Без направления"
    if (!accrualsByEmployee.has(emp.id)) accrualsByEmployee.set(emp.id, new Map())
    const m = accrualsByEmployee.get(emp.id)!
    const key = dirId ?? "__no_direction__"
    // Окладник = базовое начисление (если у преподавателя тоже есть оклад — складываем).
    const prev = m.get(key) || { directionId: dirId, directionName: dirName, amount: 0 }
    prev.amount += ms
    m.set(key, prev)
  }

  // === Корректировки и выплаты ===
  const bonusByEmp = new Map<string, number>()
  const penaltyByEmp = new Map<string, number>()
  for (const a of adjustments) {
    if (a.type === "bonus") bonusByEmp.set(a.employeeId, (bonusByEmp.get(a.employeeId) || 0) + Number(a.amount))
    else penaltyByEmp.set(a.employeeId, (penaltyByEmp.get(a.employeeId) || 0) + Number(a.amount))
  }

  const paidByEmp = new Map<string, number>()
  for (const it of paymentItems) {
    paidByEmp.set(it.employeeId, (paidByEmp.get(it.employeeId) || 0) + Number(it.amount))
  }

  // === Сборка результата ===
  const data = employees
    .map((emp) => {
      const name = [emp.lastName, emp.firstName].filter(Boolean).join(" ").trim() || "Без имени"
      const dirMap = accrualsByEmployee.get(emp.id) || new Map<string, AccrualPerDir>()
      const byDirection = Array.from(dirMap.values()).sort((a, b) => b.amount - a.amount)
      const accrued = byDirection.reduce((s, d) => s + d.amount, 0)
      const bonuses = bonusByEmp.get(emp.id) || 0
      const penalties = penaltyByEmp.get(emp.id) || 0
      const alreadyPaid = paidByEmp.get(emp.id) || 0
      const remaining = accrued + bonuses - penalties - alreadyPaid
      return {
        employeeId: emp.id,
        employeeName: name,
        role: emp.role,
        accrued: Math.round(accrued * 100) / 100,
        bonuses: Math.round(bonuses * 100) / 100,
        penalties: Math.round(penalties * 100) / 100,
        alreadyPaid: Math.round(alreadyPaid * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        byDirection,
      }
    })
    .filter(r => r.accrued !== 0 || r.bonuses !== 0 || r.penalties !== 0 || r.alreadyPaid !== 0)

  return NextResponse.json({ data, periodYear, periodMonth })
}
