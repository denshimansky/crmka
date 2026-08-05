import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requirePermission } from "@/lib/api-permissions"

/**
 * GET /api/salary-payments/accruals?periodYear&periodMonth&upTo&kind
 *
 * `upTo` (yyyy-mm-dd, опционально) — граница начислений ВНУТРИ месяца периода
 * (сценарий аванса «по 15-е включительно»): занятия учитываются по эту дату,
 * оклад берётся пропорционально дням месяца, премии/штрафы НЕ включаются
 * (они выплачиваются при полном месяце). Дата вне месяца/некорректная —
 * считается весь месяц. Выплаты (`alreadyPaid`, `paid`) всегда за весь период.
 *
 * `kind` (опционально) — тип документа выплаты, скоупит источник начислений:
 *   `salary` → только оклад (Employee.monthlySalary);
 *   `piece`  → только сделка (Attendance.instructorPayAmount);
 *   не задан / прочее → слияние обоих (обратная совместимость, как раньше).
 * Нужно, чтобы автозаполнение оклад-документа не подтягивало сделочные деньги
 * (иначе мисклассификация сделки как оклада + двойной счёт в ОПИУ).
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
 *
 * Неттинг для повторных выплат за период (аванс → остаток): по каждому
 * направлению отдаётся `paid` (строки выплат этого направления) и
 * `remaining = amount − paid`. Выплаты без направления сначала гасят
 * null-направленческое начисление (оклад окладника без defaultDirection), а их
 * остаток идёт в премии−штрафы (`adjPaid`, `adjRemaining = bonuses − penalties −
 * adjPaid`) — та же семантика, что у карточки инструктора
 * (lib/salary/instructor-detail.ts), чтобы разбивка остатка в двух местах CRM
 * совпадала (иначе строка оклада «Без направления» игнорировала бы аванс).
 * Отрицательные
 * компоненты (штраф больше премии, переплата по направлению, выплата «мимо»
 * направления) построчным неттингом не ловятся — поэтому клиент обязан
 * ограничивать сумму автозаполнения общим остатком сотрудника `remaining`.
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

  // Граница начислений внутри месяца (аванс). partial = true только если
  // upTo — валидная дата строго раньше конца месяца периода.
  const upToRaw = searchParams.get("upTo")
  let accrualEnd = monthEnd
  let partial = false
  if (upToRaw && /^\d{4}-\d{2}-\d{2}$/.test(upToRaw)) {
    const d = new Date(upToRaw + "T23:59:59.999Z")
    if (!isNaN(d.getTime()) && d >= monthStart && d < monthEnd) {
      accrualEnd = d
      partial = true
    }
  }

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
        lesson: { date: { gte: monthStart, lte: accrualEnd } },
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
      select: { employeeId: true, amount: true, directionId: true },
    }),
  ])

  // === Начисления: два раздельных источника ===
  // Держим сделку и оклад в отдельных картах, чтобы автозаполнение документа
  // выплаты можно было заскоупить по типу (kind): оклад-документ не должен
  // подтягивать сделочные деньги (двойной счёт в ОПИУ), и наоборот.
  type AccrualPerDir = { directionId: string | null; directionName: string; amount: number }
  const kind = searchParams.get("kind")

  // 1. Сделка — из посещений преподавателей (ключ направления = directionId).
  const pieceAccruals = new Map<string, Map<string, AccrualPerDir>>()
  for (const a of attendances) {
    const empId = a.lesson.substituteInstructorId || a.lesson.instructorId
    if (!empId) continue
    const dirId = a.lesson.group.directionId
    const dirName = a.lesson.group.direction.name
    if (!pieceAccruals.has(empId)) pieceAccruals.set(empId, new Map())
    const m = pieceAccruals.get(empId)!
    const key = dirId
    const prev = m.get(key) || { directionId: dirId, directionName: dirName, amount: 0 }
    prev.amount += Number(a.instructorPayAmount)
    m.set(key, prev)
  }

  // 2. Оклад — из Employee.monthlySalary (ключ = defaultDirectionId ?? "__no_direction__").
  // При границе внутри месяца оклад начисляется пропорционально дням.
  const okladAccruals = new Map<string, Map<string, AccrualPerDir>>()
  const salaryShare = partial ? accrualEnd.getUTCDate() / monthEnd.getUTCDate() : 1
  for (const emp of employees) {
    const ms = (emp.monthlySalary ? Number(emp.monthlySalary) : 0) * salaryShare
    if (ms <= 0) continue
    const dirId = emp.defaultDirectionId ?? null
    const dirName = emp.defaultDirection?.name ?? "Без направления"
    if (!okladAccruals.has(emp.id)) okladAccruals.set(emp.id, new Map())
    const m = okladAccruals.get(emp.id)!
    const key = dirId ?? "__no_direction__"
    const prev = m.get(key) || { directionId: dirId, directionName: dirName, amount: 0 }
    prev.amount += ms
    m.set(key, prev)
  }

  // Выбор источника(ов) под тип документа. По умолчанию (kind не задан) —
  // слияние обоих ПОБАЙТОВО как раньше: сначала сделка, затем оклад
  // суммируется в тот же ключ направления (сохраняя directionName сделки).
  let accrualsByEmployee: Map<string, Map<string, AccrualPerDir>>
  if (kind === "salary") {
    accrualsByEmployee = okladAccruals
  } else if (kind === "piece") {
    accrualsByEmployee = pieceAccruals
  } else {
    accrualsByEmployee = new Map<string, Map<string, AccrualPerDir>>()
    const mergeInto = (source: Map<string, Map<string, AccrualPerDir>>) => {
      for (const [empId, dirMap] of source) {
        if (!accrualsByEmployee.has(empId)) accrualsByEmployee.set(empId, new Map())
        const tm = accrualsByEmployee.get(empId)!
        for (const [key, entry] of dirMap) {
          const prev = tm.get(key) || { directionId: entry.directionId, directionName: entry.directionName, amount: 0 }
          prev.amount += entry.amount
          tm.set(key, prev)
        }
      }
    }
    mergeInto(pieceAccruals)
    mergeInto(okladAccruals)
  }

  // === Корректировки и выплаты ===
  const bonusByEmp = new Map<string, number>()
  const penaltyByEmp = new Map<string, number>()
  // Премии/штрафы — только при полном месяце: в аванс они не включаются,
  // adjRemaining при partial становится ≤ 0 и строка премий не заполняется.
  for (const a of partial ? [] : adjustments) {
    if (a.type === "bonus") bonusByEmp.set(a.employeeId, (bonusByEmp.get(a.employeeId) || 0) + Number(a.amount))
    else penaltyByEmp.set(a.employeeId, (penaltyByEmp.get(a.employeeId) || 0) + Number(a.amount))
  }

  const paidByEmp = new Map<string, number>()
  const paidByEmpDir = new Map<string, number>() // `${employeeId}:${directionId ?? "null"}`
  for (const it of paymentItems) {
    paidByEmp.set(it.employeeId, (paidByEmp.get(it.employeeId) || 0) + Number(it.amount))
    const key = `${it.employeeId}:${it.directionId ?? "null"}`
    paidByEmpDir.set(key, (paidByEmpDir.get(key) || 0) + Number(it.amount))
  }

  // === Сборка результата ===
  const r2 = (n: number) => Math.round(n * 100) / 100
  const data = employees
    .map((emp) => {
      const name = [emp.lastName, emp.firstName].filter(Boolean).join(" ").trim() || "Без имени"
      const dirMap = accrualsByEmployee.get(emp.id) || new Map<string, AccrualPerDir>()
      const accruedRows = Array.from(dirMap.values()).sort((a, b) => b.amount - a.amount)
      const accrued = accruedRows.reduce((s, d) => s + d.amount, 0)
      const bonuses = bonusByEmp.get(emp.id) || 0
      const penalties = penaltyByEmp.get(emp.id) || 0
      const alreadyPaid = paidByEmp.get(emp.id) || 0
      const remaining = accrued + bonuses - penalties - alreadyPaid

      // Выплаты без направления (directionId=null) относим СНАЧАЛА к null-направленческому
      // начислению (оклад окладника без defaultDirection), остаток — в премии−штрафы.
      // Та же логика, что в buildInstructorSalaryDetail (карточка инструктора), чтобы
      // разбивка остатка в двух местах CRM совпадала: иначе строка «Без направления»
      // показывала бы весь оклад/остаток, игнорируя уже выплаченный аванс.
      const adjPaidRaw = paidByEmpDir.get(`${emp.id}:null`) || 0
      const nullAccrued = accruedRows
        .filter((d) => d.directionId === null)
        .reduce((s, d) => s + d.amount, 0)
      const okladNullPaid = Math.min(adjPaidRaw, nullAccrued)
      const adjPaid = adjPaidRaw - okladNullPaid
      const adjNet = bonuses - penalties

      // Разносим okladNullPaid по null-строкам начислений (обычно одна — оклад).
      let nullBudget = okladNullPaid
      const byDirection = accruedRows.map((d) => {
        let paid: number
        if (d.directionId === null) {
          paid = Math.min(nullBudget, d.amount)
          nullBudget = r2(nullBudget - paid)
        } else {
          paid = paidByEmpDir.get(`${emp.id}:${d.directionId}`) || 0
        }
        return {
          directionId: d.directionId,
          directionName: d.directionName,
          amount: r2(d.amount),
          paid: r2(paid),
          remaining: r2(d.amount - paid),
        }
      })

      return {
        employeeId: emp.id,
        employeeName: name,
        role: emp.role,
        accrued: r2(accrued),
        bonuses: r2(bonuses),
        penalties: r2(penalties),
        adjNet: r2(adjNet),
        adjPaid: r2(adjPaid),
        adjRemaining: r2(adjNet - adjPaid),
        alreadyPaid: r2(alreadyPaid),
        remaining: r2(remaining),
        byDirection,
      }
    })
    .filter(r => r.accrued !== 0 || r.bonuses !== 0 || r.penalties !== 0 || r.alreadyPaid !== 0)

  return NextResponse.json({ data, periodYear, periodMonth })
}
