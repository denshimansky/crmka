import type { Prisma } from "@prisma/client"
import { resolveOkladForPeriod } from "./oklad-context"
import {
  computeOkladTwinPortion,
  okladRecognitionTarget,
  okladTwinRecognition,
  buildOkladTwin,
} from "./oklad-twin"

/**
 * Пересобирает оклад-твин(ы) сотрудника за период С НУЛЯ (снести все → создать один).
 *
 * Модель «один твин на (сотрудник, период)»: снимает зависимость от порядка выплат и
 * гонки alreadyTwinned — при любой мутации (создание/правка/удаление выплаты) твин
 * пересчитывается по СУММЕ всех выплат периода. Признаём в ОПИУ по факту выплаты, но
 * не больше НЕ-сделочной ЗП периода = оклад + премии − штрафы
 * (см. okladRecognitionTarget): потолок отсекает сделочную часть совмещающего (она
 * начисляется отдельно из посещений) и аванс/переплату, но НЕ теряет реальную премию.
 * Признание — всегда месяц периода (см. okladTwinRecognition), поэтому ресинк
 * детерминирован и не «плывёт».
 *
 * kind-независимо. Вызывать ВНУТРИ money-транзакции, ПОСЛЕ создания/удаления выплат и
 * SalaryAdjustment периода (иначе netAdjustment/сумма выплат будут неполными).
 * Возвращает признанную сумму (0 — если не окладник / нечего признавать).
 *
 * Оклад периода функция резолвит САМА (resolveOkladForPeriod: база + okladFrom +
 * версии OkladSchedule). Раньше сумму передавали снаружи сырым monthlySalary, и
 * признание расхода игнорировало и дату начала оклада, и версии: за июль сотруднику
 * с окладом «с августа» начисление давало 0, а в июльский ОПИУ уходил полный оклад.
 */
/**
 * Пересобрать оклад-твины сотрудника за ВСЕ периоды с выплатами начиная с указанного
 * месяца. Нужен после правки истории оклада: признание расхода в ОПИУ капается
 * окладом периода, поэтому новая или удалённая версия меняет уже проведённые месяцы.
 */
export async function resyncOkladTwinsFromMonth(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string
    employeeId: string
    fromYear: number
    fromMonth: number
    okladCategoryId: string
    createdBy: string | null
  },
): Promise<number> {
  const periods = await tx.salaryPayment.findMany({
    where: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      OR: [
        { periodYear: { gt: input.fromYear } },
        { periodYear: input.fromYear, periodMonth: { gte: input.fromMonth } },
      ],
    },
    select: { periodYear: true, periodMonth: true },
    distinct: ["periodYear", "periodMonth"],
  })
  for (const p of periods) {
    await syncOkladTwinsForEmployeePeriod(tx, {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      periodYear: p.periodYear,
      periodMonth: p.periodMonth,
      okladCategoryId: input.okladCategoryId,
      createdBy: input.createdBy,
    })
  }
  return periods.length
}

export async function syncOkladTwinsForEmployeePeriod(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string
    employeeId: string
    periodYear: number
    periodMonth: number
    okladCategoryId: string
    createdBy: string | null
  },
): Promise<number> {
  // 1. Снести все прежние твины сотрудника за период — пересобираем с нуля.
  await tx.expense.deleteMany({
    where: {
      tenantId: input.tenantId,
      salaryPayment: {
        employeeId: input.employeeId,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
      },
    },
  })

  // Оклад за ЭТОТ период (база + okladFrom + версии) и его атрибуция: направление
  // для ОПИУ и филиалы (Employee.okladBranchIds; пусто → твин без филиала, в ОПИУ
  // разносится по всей сети ∝ выручке).
  const oklad = await resolveOkladForPeriod(tx, {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    periodYear: input.periodYear,
    periodMonth: input.periodMonth,
  })
  if (oklad.amount <= 0) return 0

  // 2. Всего выплачено сотруднику за период (по всем выплатам).
  const paidAgg = await tx.salaryPayment.aggregate({
    where: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
    },
    _sum: { amount: true },
  })
  const totalPaid = Number(paidAgg._sum.amount ?? 0)
  if (totalPaid <= 0) return 0

  // 3. Премии − штрафы за период — ТОЛЬКО окладные (без направления). Направленные
  // (directionId != null) относятся к сдельной части и не входят в окладный потолок,
  // иначе сдельная премия раздула бы окладный расход в ОПИУ. См. lib/salary/kind-split.
  const adjustments = await tx.salaryAdjustment.findMany({
    where: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      directionId: null,
    },
    select: { type: true, amount: true },
  })
  const netAdjustment = adjustments.reduce(
    (s, a) => s + (a.type === "bonus" ? Number(a.amount) : -Number(a.amount)),
    0,
  )

  const target = okladRecognitionTarget(oklad.amount, netAdjustment)
  const portion = computeOkladTwinPortion({ monthlySalary: target, paymentTotal: totalPaid, alreadyTwinned: 0 })
  if (portion <= 0) return 0

  // 4. Якорь — последняя выплата периода (нужен salaryPaymentId для FK).
  const anchor = await tx.salaryPayment.findFirst({
    where: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  })
  if (!anchor) return 0

  const recognition = okladTwinRecognition(input.periodYear, input.periodMonth)
  const twin = buildOkladTwin({
    tenantId: input.tenantId,
    categoryId: input.okladCategoryId,
    salaryPaymentId: anchor.id,
    amount: portion,
    directionId: oklad.defaultDirectionId,
    recognition,
    createdBy: input.createdBy,
  })

  const exp = await tx.expense.create({
    data: {
      tenantId: twin.tenantId,
      categoryId: twin.categoryId,
      accountId: null,
      amount: twin.amount,
      date: twin.date,
      recognitionMode: twin.recognitionMode,
      amortizationStartDate: twin.amortizationStartDate,
      amortizationMonths: twin.amortizationMonths,
      isVariable: false,
      salaryPaymentId: twin.salaryPaymentId,
      createdBy: twin.createdBy,
    },
    select: { id: true },
  })
  // Привязка твина к филиалам/направлению (семантика 1:1 с формой расхода):
  //  • выбраны филиалы → строка на каждый филиал (branchId, directionId оклада) →
  //    оклад разносится на выбранные филиалы ∝ выручке (внутри — по направлению);
  //  • филиалы не выбраны, но есть направление → одна строка (branchId=null, directionId);
  //  • ни филиалов, ни направления → без строки (общий расход ∝ всей сети).
  if (oklad.okladBranchIds.length > 0) {
    await tx.expenseBranch.createMany({
      data: oklad.okladBranchIds.map((branchId) => ({
        tenantId: input.tenantId,
        expenseId: exp.id,
        branchId,
        directionId: twin.directionId,
      })),
    })
  } else if (twin.directionId) {
    await tx.expenseBranch.create({
      data: { tenantId: input.tenantId, expenseId: exp.id, branchId: null, directionId: twin.directionId },
    })
  }
  return portion
}
