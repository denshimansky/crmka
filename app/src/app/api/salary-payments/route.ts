import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { z } from "zod"
import { logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/api-permissions"
import { syncOkladTwinsForEmployeePeriod } from "@/lib/salary/sync-oklad-twin"
import { getOkladCategoryId } from "@/lib/salary/oklad-category"
import { getBranchScope } from "@/lib/session"
import { scopeEmployee } from "@/lib/branch-scope"
import { kindOfDirection } from "@/lib/salary/kind-split"

// Legacy: одна выплата = (employee × account × amount). Используется простым диалогом
// «Провести выплату». Сохраняется как SalaryPayment + одна позиция SalaryPaymentItem
// (directionId = null) для согласованности с новым flow.
const legacySchema = z.object({
  employeeId: z.string().uuid("Выберите сотрудника"),
  accountId: z.string().uuid("Выберите счёт"),
  amount: z.number().min(0.01, "Сумма должна быть больше 0"),
  date: z.string().min(1, "Укажите дату"),
  periodYear: z.number().int(),
  periodMonth: z.number().int().min(1).max(12),
  periodHalf: z.any().transform(v => {
    const n = Number(v)
    return n === 1 || n === 2 ? n : undefined
  }),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  kind: z.enum(["salary", "piece"]).default("piece"),
  recognitionMode: z.enum(["by_payment_date", "single_period", "amortized", "not_in_pnl"]).default("by_payment_date"),
  amortizationStartDate: z.string().optional().nullable(),
  amortizationMonths: z.number().int().min(1).max(60).optional().nullable(),
})

// Document: одна выплата = N позиций (сотрудник × счёт × направление × сумма).
// Используется страницей /salary/payments/new с кнопкой «Заполнить».
const docSchema = z.object({
  date: z.string().min(1, "Укажите дату"),
  periodYear: z.number().int(),
  periodMonth: z.number().int().min(1).max(12),
  periodHalf: z.any().transform(v => {
    const n = Number(v)
    return n === 1 || n === 2 ? n : undefined
  }),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  items: z.array(z.object({
    employeeId: z.string().uuid(),
    accountId: z.string().uuid(),
    directionId: z.string().uuid().nullable().optional(),
    amount: z.number().min(0.01),
    comment: z.string().optional().nullable(),
  })).default([]),
  // Премия/депремирование, создаются как SalaryAdjustment в той же транзакции,
  // что и выплата (атомарно). Премию клиент дополнительно кладёт в items
  // (выплачивается сейчас); штраф — только начисление (уменьшает «Осталось»),
  // в items НЕ попадает.
  adjustments: z.array(z.object({
    employeeId: z.string().uuid(),
    // Направление премии/депремирования: != null → сдельная (вкладка «Сделка»),
    // null → окладная. Комментарий опционален (у сдельной метка = направление).
    directionId: z.string().uuid().nullable().optional(),
    type: z.enum(["bonus", "penalty"]),
    amount: z.number().min(0.01),
    comment: z.string().optional().nullable(),
  })).default([]),
  kind: z.enum(["salary", "piece"]).default("piece"),
  recognitionMode: z.enum(["by_payment_date", "single_period", "amortized", "not_in_pnl"]).default("by_payment_date"),
  amortizationStartDate: z.string().optional().nullable(),
  amortizationMonths: z.number().int().min(1).max(60).optional().nullable(),
}).refine((d) => d.items.length > 0 || d.adjustments.length > 0, {
  message: "Добавьте строку выплаты или премию/штраф",
  path: ["items"],
})

export async function GET(req: NextRequest) {
  const guard = await requirePermission("finance.salary")
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  // `year`/`month` — алиасы `periodYear`/`periodMonth` (ConductedPaymentsList шлёт короткие
  // имена); оставляем и длинные для обратной совместимости с существующими вызовами.
  const periodYear = Number(searchParams.get("periodYear") ?? searchParams.get("year")) || new Date().getFullYear()
  const periodMonth = Number(searchParams.get("periodMonth") ?? searchParams.get("month")) || new Date().getMonth() + 1
  const employeeId = searchParams.get("employeeId")
  // kind: "salary" (окладные — есть твин-Expense) | "piece" (сдельные — твина нет).
  const kind = searchParams.get("kind")

  // ADM-04: список выплат скоупим по филиалу как ведомость. Инструкторов тут нет —
  // GET закрыт requirePermission("finance.salary") (у инструктора права нет), поэтому
  // достаточно scopeEmployee: owner/manager → {} (все), админ филиала → его сотрудники.
  const scope = await getBranchScope()
  const where: any = {
    tenantId: session.user.tenantId,
    periodYear,
    periodMonth,
    employee: scopeEmployee(scope),
  }
  if (employeeId) where.employeeId = employeeId

  const payments = await db.salaryPayment.findMany({
    where,
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, role: true, monthlySalary: true } },
      account: { select: { id: true, name: true } },
      items: {
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
          account: { select: { id: true, name: true } },
          direction: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { date: "desc" },
  })

  // Обогащаем ответ плоскими полями для ConductedPaymentsList (employeeName/accountName/
  // date как YYYY-MM-DD) + разбивкой суммы по типу ЗП (okladAmount/pieceAmount),
  // сохраняя исходную структуру (employee/account/items) — существующие вызовы GET не
  // ломаются. Тип определяется ПО СТРОКАМ (directionId), а не по monthlySalary>0: у
  // совместителя одна выплата бывает смешанной, и бакетирование по признаку окладника
  // отправляло ВСЕ его выплаты (включая чисто сделочные) только на вкладку «Оклады».
  const r2 = (n: number) => Math.round(n * 100) / 100
  let enriched = payments.map((p) => {
    const hasOklad = Number(p.employee?.monthlySalary ?? 0) > 0
    let okladAmount = 0
    let pieceAmount = 0
    for (const it of p.items) {
      if (kindOfDirection(it.directionId, hasOklad) === "salary") okladAmount += Number(it.amount)
      else pieceAmount += Number(it.amount)
    }
    // Легаси-выплаты без строк items — весь amount по признаку окладника.
    if (p.items.length === 0) {
      if (hasOklad) okladAmount = Number(p.amount)
      else pieceAmount = Number(p.amount)
    }
    return {
      ...p,
      employeeName: [p.employee?.lastName, p.employee?.firstName].filter(Boolean).join(" ").trim() || p.employee?.id || "",
      accountName: p.account?.name ?? "",
      isOklad: hasOklad,
      okladAmount: r2(okladAmount),
      pieceAmount: r2(pieceAmount),
      date: p.date.toISOString().slice(0, 10),
    }
  })

  // Выплата показывается на вкладке, если у неё есть суммы этого типа (смешанная —
  // на обеих). Аннулирование удаляет выплату целиком, поэтому это честно.
  if (kind === "salary") enriched = enriched.filter((p) => p.okladAmount > 0)
  else if (kind === "piece") enriched = enriched.filter((p) => p.pieceAmount > 0)

  return NextResponse.json(enriched)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Зарплатные выплаты доступны только владельцу и управляющему" }, { status: 403 })
  }

  const body = await req.json()
  const tenantId = session.user.tenantId
  const employeeId = session.user.employeeId

  // === Документ с items / премиями-штрафами ===
  if (Array.isArray(body?.items) || Array.isArray(body?.adjustments)) {
    const parsed = docSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
    }
    const data = parsed.data

    if (await isPeriodLocked(tenantId, new Date(Date.UTC(data.periodYear, data.periodMonth - 1, 1)), role)) {
      return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
    }

    // Проверяем сотрудников/счета/направления одним прогоном. employeeId берём и
    // из выплат (items), и из премий/штрафов (adjustments) — премия/штраф могут
    // идти без выплаты.
    const employeeIds = Array.from(new Set([
      ...data.items.map(i => i.employeeId),
      ...data.adjustments.map(a => a.employeeId),
    ]))
    const accountIds = Array.from(new Set(data.items.map(i => i.accountId)))
    const directionIds = Array.from(new Set(data.items.map(i => i.directionId).filter((v): v is string => !!v)))

    const [employees, accounts, directions] = await Promise.all([
      db.employee.findMany({ where: { id: { in: employeeIds }, tenantId }, select: { id: true, monthlySalary: true, defaultDirectionId: true } }),
      accountIds.length > 0
        ? db.financialAccount.findMany({ where: { id: { in: accountIds }, tenantId }, select: { id: true } })
        : Promise.resolve([] as Array<{ id: string }>),
      directionIds.length > 0
        ? db.direction.findMany({ where: { id: { in: directionIds }, tenantId }, select: { id: true } })
        : Promise.resolve([] as Array<{ id: string }>),
    ])
    if (employees.length !== employeeIds.length) {
      return NextResponse.json({ error: "Один или несколько сотрудников не найдены" }, { status: 404 })
    }
    if (accounts.length !== accountIds.length) {
      return NextResponse.json({ error: "Один или несколько счетов не найдены" }, { status: 404 })
    }
    if (directions.length !== directionIds.length) {
      return NextResponse.json({ error: "Одно или несколько направлений не найдены" }, { status: 404 })
    }

    const totalAmount = data.items.reduce((s, it) => s + it.amount, 0)

    // Оклад-твин создаём для реального окладника (monthlySalary>0) НЕЗАВИСИМО от kind:
    // раньше твин требовал kind='salary', но основной диалог выплаты («Выплатить
    // остатки» из карточки) kind не шлёт → оклад не попадал в ОПИУ. Твин считается по
    // потолку «оклад + премии − штрафы» за период (см. syncOkladTwinsForEmployeePeriod):
    // сделочная часть выплаты совмещающего отсекается потолком и не задваивается.
    const empById = new Map(employees.map((e) => [e.id, e]))
    const anyOkladnik = employees.some((e) => Number(e.monthlySalary) > 0)
    // Категорию оклад-расхода резолвим ДО money-транзакции (гонку партиал-UNIQUE
    // безопасно перехватить только вне tx — см. getOkladCategoryId).
    const okladCategoryId = anyOkladnik ? await getOkladCategoryId() : null

    const payment = await db.$transaction(async (tx) => {
      let p: { id: string } | null = null

      // Премии/штрафы за период создаём ПЕРВЫМИ — их netAdjustment входит в потолок
      // оклад-твина (пересинк ниже). Период-уровневые: аннулирование выплаты их не трогает.
      if (data.adjustments.length > 0) {
        await tx.salaryAdjustment.createMany({
          data: data.adjustments.map((a) => ({
            tenantId,
            employeeId: a.employeeId,
            directionId: a.directionId ?? null,
            type: a.type,
            amount: a.amount,
            periodYear: data.periodYear,
            periodMonth: data.periodMonth,
            comment: a.comment ?? null,
            createdBy: employeeId,
          })),
        })
      }

      // Выплата (может отсутствовать, если проводят только премию/штраф).
      if (data.items.length > 0) {
        // Одна SalaryPayment = один сотрудник. Документ выплаты может охватывать
        // нескольких (кнопка «Заполнить» тянет начисления по всем) — группируем
        // позиции по сотруднику и создаём отдельную выплату на каждого. Иначе шапка
        // (employeeId/amount) приписывала бы всю сумму документа первому сотруднику,
        // а ведомость/ДДС, читающие по шапке, показали бы чужие деньги (баг ДЦ Easy).
        const itemsByEmployee = new Map<string, typeof data.items>()
        for (const it of data.items) {
          const bucket = itemsByEmployee.get(it.employeeId)
          if (bucket) bucket.push(it)
          else itemsByEmployee.set(it.employeeId, [it])
        }

        for (const [empId, empItems] of itemsByEmployee.entries()) {
          const created = await tx.salaryPayment.create({
            data: {
              tenantId,
              employeeId: empId,
              accountId: empItems[0].accountId,
              amount: empItems.reduce((s, it) => s + it.amount, 0),
              date: new Date(data.date),
              periodYear: data.periodYear,
              periodMonth: data.periodMonth,
              periodHalf: data.periodHalf,
              comment: data.comment,
              createdBy: employeeId,
            },
          })
          if (!p) p = created

          await tx.salaryPaymentItem.createMany({
            data: empItems.map((it) => ({
              tenantId,
              salaryPaymentId: created.id,
              employeeId: it.employeeId,
              accountId: it.accountId,
              directionId: it.directionId ?? null,
              amount: it.amount,
              comment: it.comment ?? null,
            })),
          })
        }

        // Списываем суммы со счетов (агрегируем по счёту, чтобы не дёргать update N раз).
        const byAccount = new Map<string, number>()
        for (const it of data.items) {
          byAccount.set(it.accountId, (byAccount.get(it.accountId) || 0) + it.amount)
        }
        for (const [accId, sum] of byAccount.entries()) {
          await tx.financialAccount.update({ where: { id: accId }, data: { balance: { decrement: sum } } })
        }
      }

      // Оклад-твин(ы) — ПОСЛЕ создания всех выплат И премий/штрафов периода (чтобы
      // сумма выплат и netAdjustment были полными). Пересинк per-period для каждого
      // затронутого окладника (из выплат ИЛИ премий/штрафов); accountId=NULL → только ОПИУ.
      if (okladCategoryId) {
        const okladnikToResync = new Set(
          [...data.items.map((i) => i.employeeId), ...data.adjustments.map((a) => a.employeeId)]
            .filter((id) => Number(empById.get(id)?.monthlySalary ?? 0) > 0),
        )
        for (const empId of okladnikToResync) {
          const emp = empById.get(empId)!
          await syncOkladTwinsForEmployeePeriod(tx, {
            tenantId,
            employeeId: empId,
            monthlySalary: Number(emp.monthlySalary),
            defaultDirectionId: emp.defaultDirectionId ?? null,
            periodYear: data.periodYear,
            periodMonth: data.periodMonth,
            okladCategoryId,
            createdBy: employeeId ?? null,
          })
        }
      }

      return p
    })

    logAudit({
      tenantId,
      employeeId,
      action: "create",
      entityType: "SalaryPayment",
      entityId: payment?.id ?? "adjustments-only",
      changes: {
        amount: { new: totalAmount },
        items: { new: data.items.length },
        adjustments: { new: data.adjustments.length },
        periodYear: { new: data.periodYear },
        periodMonth: { new: data.periodMonth },
      },
      req,
    })

    return NextResponse.json(payment ?? { ok: true, adjustments: data.adjustments.length }, { status: 201 })
  }

  // === Legacy: одна выплата ===
  const parsed = legacySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const [employee, account] = await Promise.all([
    db.employee.findFirst({ where: { id: data.employeeId, tenantId }, select: { id: true, defaultDirectionId: true, monthlySalary: true } }),
    db.financialAccount.findFirst({ where: { id: data.accountId, tenantId }, select: { id: true } }),
  ])
  if (!employee) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
  if (!account) return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })

  if (await isPeriodLocked(tenantId, new Date(Date.UTC(data.periodYear, data.periodMonth - 1, 1)), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  // Твин только для реального окладника (monthlySalary>0), kind-независимо. Категорию
  // резолвим до tx (гонку партиал-UNIQUE ловим только вне tx — см. getOkladCategoryId).
  const legacyIsOkladnik = Number(employee.monthlySalary) > 0
  const legacyOkladCategoryId = legacyIsOkladnik ? await getOkladCategoryId() : null

  const payment = await db.$transaction(async (tx) => {
    const p = await tx.salaryPayment.create({
      data: {
        tenantId,
        employeeId: data.employeeId,
        accountId: data.accountId,
        amount: data.amount,
        date: new Date(data.date),
        periodYear: data.periodYear,
        periodMonth: data.periodMonth,
        periodHalf: data.periodHalf,
        comment: data.comment,
        createdBy: employeeId,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, role: true } },
        account: { select: { id: true, name: true } },
      },
    })

    // Зеркальная позиция в items — чтобы новый журнал ДДС и ОПИУ видели одну и ту же
    // запись независимо от того, через какой UI создана выплата.
    await tx.salaryPaymentItem.create({
      data: {
        tenantId,
        salaryPaymentId: p.id,
        employeeId: data.employeeId,
        accountId: data.accountId,
        directionId: null,
        amount: data.amount,
        comment: data.comment ?? null,
      },
    })

    // Оклад-выплата → твин-расход для ОПИУ (accountId=NULL). Направление — из карточки
    // сотрудника. Пересинк per-period: потолок «оклад + премии − штрафы» отсекает
    // сделочную часть совмещающего (см. syncOkladTwinsForEmployeePeriod).
    if (legacyIsOkladnik && legacyOkladCategoryId) {
      await syncOkladTwinsForEmployeePeriod(tx, {
        tenantId,
        employeeId: data.employeeId,
        monthlySalary: Number(employee.monthlySalary),
        defaultDirectionId: employee.defaultDirectionId ?? null,
        periodYear: data.periodYear,
        periodMonth: data.periodMonth,
        okladCategoryId: legacyOkladCategoryId,
        createdBy: employeeId ?? null,
      })
    }

    await tx.financialAccount.update({
      where: { id: data.accountId },
      data: { balance: { decrement: data.amount } },
    })

    return p
  })

  logAudit({
    tenantId,
    employeeId,
    action: "create",
    entityType: "SalaryPayment",
    entityId: payment.id,
    changes: { amount: { new: data.amount }, employeeId: { new: data.employeeId }, periodYear: { new: data.periodYear }, periodMonth: { new: data.periodMonth } },
    req,
  })

  return NextResponse.json(payment, { status: 201 })
}
