/**
 * Backfill оклад-твинов (Expense) по историческим выплатам окладникам.
 *
 * Контекст (диагноз 05.08.2026): твин-расход «Зарплата окладников» — единственный
 * путь оклада в ОПИУ, но создавался только при kind='salary', а фактический диалог
 * выплаты его не слал → окладный ФОТ отсутствовал в финрезе у всех орг. Форвард-фикс
 * (kind-независимый твин с потолком monthlySalary) уже в коде; этот скрипт добирает
 * ИСТОРИЮ — по уже проведённым выплатам.
 *
 * Логика (совпадает с lib/salary/sync-oklad-twin.ts):
 *   для каждого окладника (monthly_salary>0) и каждого периода с выплатами:
 *     оклад к признанию = min(Σ выплат за период, monthly_salary) − уже_признанный_твин;
 *     если > 0 → один Expense (accountId=NULL, категория «Зарплата окладников»,
 *     direction = defaultDirection, признание = месяц периода) на ПОСЛЕДНЮЮ выплату периода.
 *
 * Защита от ДВОЙНОГО СЧЁТА: период ПРОПУСКАЕТСЯ, если у организации есть РУЧНОЙ расход
 * в системной ЗП-категории (администраторов/управляющего/инструкторов) за тот же
 * месяц — значит оклад уже, вероятно, внесён вручную (Dream, «Умные дети» и т.п.).
 *
 * Идемпотентность: повторный запуск не задваивает — учитывает уже созданные твины.
 *
 * Запуск (в контейнере app):
 *   dry-run (по умолчанию):  docker compose exec app npx tsx prisma/scripts/backfill-oklad-twins.ts
 *   применить:               docker compose exec -e APPLY=1 app npx tsx prisma/scripts/backfill-oklad-twins.ts
 *   одна орг:                docker compose exec -e TENANT="ДЦ Умный Я" app npx tsx prisma/scripts/backfill-oklad-twins.ts
 *
 * НЕ запускается автоматически миграцией.
 */
import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

const OKLAD_CATEGORY_NAME = "Зарплата окладников"
// Системные ЗП-категории, ручной расход в которых сигналит, что орг вносит зарплату
// вручную (значит оклад окладника уже, вероятно, там — не добавляем твин поверх).
const SYSTEM_SALARY_CATS = ["Зарплата администраторов", "Зарплата управляющего", "Зарплата инструкторов"]

const APPLY = process.env.APPLY === "1"
const TENANT_FILTER = process.env.TENANT?.trim() || null
const r2 = (n: number) => Math.round(n * 100) / 100

async function main() {
  console.log(APPLY ? "=== BACKFILL: APPLY (запись в БД) ===" : "=== BACKFILL: DRY-RUN (без записи) ===")

  const okladCategory = await db.expenseCategory.findFirst({
    where: { name: OKLAD_CATEGORY_NAME, tenantId: null },
    select: { id: true },
  })
  if (!okladCategory) throw new Error(`Категория «${OKLAD_CATEGORY_NAME}» (tenant_id=NULL) не найдена — сначала миграция сида`)

  const tenants = await db.organization.findMany({ select: { id: true, name: true } })
  let grandCreated = 0
  let grandAmount = 0
  let grandSkipped = 0

  for (const tenant of tenants) {
    if (TENANT_FILTER && tenant.name !== TENANT_FILTER && tenant.id !== TENANT_FILTER) continue

    const okladniki = await db.employee.findMany({
      where: { tenantId: tenant.id, monthlySalary: { gt: 0 } },
      select: { id: true, firstName: true, lastName: true, monthlySalary: true, defaultDirectionId: true },
    })
    if (okladniki.length === 0) continue

    // Месяцы с ручной системной ЗП у этой орг → защита от двойного счёта. Ключуем и
    // по месяцу расхода, и по ПРЕДЫДУЩЕМУ месяцу: ЗП за месяц M часто вносят расходом
    // с датой M+1 (значит период M тоже «покрыт» ручной ЗП).
    const manualSalary = await db.expense.findMany({
      where: {
        tenantId: tenant.id,
        deletedAt: null,
        salaryPaymentId: null,
        category: { name: { in: SYSTEM_SALARY_CATS } },
      },
      select: { date: true },
    })
    const manualMonths = new Set<string>()
    for (const e of manualSalary) {
      const y = e.date.getUTCFullYear()
      const m = e.date.getUTCMonth() + 1 // 1..12
      manualMonths.add(`${y}-${m}`)
      const prevM = m === 1 ? 12 : m - 1
      const prevY = m === 1 ? y - 1 : y
      manualMonths.add(`${prevY}-${prevM}`)
    }

    // Премии/штрафы окладников этой орг — входят в потолок признания (оклад + нетто).
    const adjustments = await db.salaryAdjustment.findMany({
      where: { tenantId: tenant.id, employeeId: { in: okladniki.map((e) => e.id) } },
      select: { employeeId: true, periodYear: true, periodMonth: true, type: true, amount: true },
    })
    const netAdjByKey = new Map<string, number>()
    for (const a of adjustments) {
      const key = `${a.employeeId}|${a.periodYear}-${a.periodMonth}`
      const delta = a.type === "bonus" ? Number(a.amount) : -Number(a.amount)
      netAdjByKey.set(key, (netAdjByKey.get(key) ?? 0) + delta)
    }

    // Предупреждение о ЛЮБОЙ ручной ЗП (вкл. кастомные категории, напр. «Оклады»/«ЗП»),
    // которую авто-пропуск по системным именам НЕ ловит → риск двойного счёта. Не
    // блокирует, но требует ручной сверки dry-run перед APPLY по этой орг.
    const manualAnySalary = await db.expense.findMany({
      where: {
        tenantId: tenant.id,
        deletedAt: null,
        salaryPaymentId: null,
        category: { isSalary: true, NOT: { name: OKLAD_CATEGORY_NAME } },
      },
      select: { amount: true, category: { select: { name: true } } },
    })
    const manualByCat = new Map<string, number>()
    for (const e of manualAnySalary) {
      manualByCat.set(e.category.name, (manualByCat.get(e.category.name) ?? 0) + Number(e.amount))
    }

    const lines: string[] = []
    let tenantCreated = 0
    let tenantAmount = 0

    for (const emp of okladniki) {
      const ms = Number(emp.monthlySalary)
      const name = [emp.lastName, emp.firstName].filter(Boolean).join(" ").trim() || emp.id

      // Периоды с выплатами этого сотрудника.
      const periods = await db.salaryPayment.groupBy({
        by: ["periodYear", "periodMonth"],
        where: { tenantId: tenant.id, employeeId: emp.id },
        _sum: { amount: true },
      })

      for (const p of periods) {
        const periodKey = `${p.periodYear}-${p.periodMonth}`
        const totalPaid = Number(p._sum.amount ?? 0)
        if (totalPaid <= 0) continue

        if (manualMonths.has(periodKey)) {
          grandSkipped++
          lines.push(`   ПРОПУСК ${name} ${periodKey}: у орг ручная системная ЗП за месяц (риск двойного счёта)`)
          continue
        }

        // Уже признанный оклад-твин по выплатам этого сотрудника за период.
        const existing = await db.expense.aggregate({
          where: {
            tenantId: tenant.id,
            deletedAt: null,
            salaryPayment: { employeeId: emp.id, periodYear: p.periodYear, periodMonth: p.periodMonth },
          },
          _sum: { amount: true },
        })
        const alreadyTwinned = Number(existing._sum.amount ?? 0)
        // Потолок признания = оклад + премии − штрафы за период (совпадает с форвард-
        // логикой lib/salary/sync-oklad-twin.ts — иначе реальная премия окладнику пропала бы).
        const netAdj = netAdjByKey.get(`${emp.id}|${periodKey}`) ?? 0
        const target = Math.max(0, r2(ms + netAdj))
        const toCreate = r2(Math.max(0, Math.min(totalPaid, target) - alreadyTwinned))
        if (toCreate <= 0) continue

        // Твин вешаем на ПОСЛЕДНЮЮ выплату периода (нужен salary_payment_id для FK).
        const anchor = await db.salaryPayment.findFirst({
          where: { tenantId: tenant.id, employeeId: emp.id, periodYear: p.periodYear, periodMonth: p.periodMonth },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          select: { id: true },
        })
        if (!anchor) continue

        const recogDate = new Date(Date.UTC(p.periodYear, p.periodMonth - 1, 1))
        lines.push(`   + ${name} ${periodKey}: ${toCreate}₽ (выплачено ${totalPaid}, оклад ${ms}${netAdj ? `, премии−штрафы ${r2(netAdj)}` : ""})`)
        tenantCreated++
        tenantAmount += toCreate

        if (APPLY) {
          await db.$transaction(async (tx) => {
            const exp = await tx.expense.create({
              data: {
                tenantId: tenant.id,
                categoryId: okladCategory.id,
                accountId: null,
                amount: toCreate,
                date: recogDate,
                recognitionMode: "single_period",
                amortizationStartDate: recogDate,
                amortizationMonths: 1,
                isVariable: false,
                salaryPaymentId: anchor.id,
                createdBy: null,
                comment: "backfill оклад-твин",
              },
              select: { id: true },
            })
            if (emp.defaultDirectionId) {
              await tx.expenseBranch.create({
                data: { tenantId: tenant.id, expenseId: exp.id, branchId: null, directionId: emp.defaultDirectionId },
              })
            }
          })
        }
      }
    }

    if (tenantCreated > 0 || lines.length > 0) {
      console.log(`\n>>> ${tenant.name}: ${tenantCreated} твинов, ${r2(tenantAmount)}₽`)
      if (tenantCreated > 0 && manualByCat.size > 0) {
        const cats = [...manualByCat.entries()].map(([n, s]) => `${n}: ${r2(s)}₽`).join("; ")
        console.log(`   ⚠ У орг есть РУЧНАЯ ЗП в категориях [${cats}] — сверьте вручную: если оклад окладника уже там, backfill его ЗАДВОИТ.`)
      }
      lines.forEach((l) => console.log(l))
    }
    grandCreated += tenantCreated
    grandAmount += tenantAmount
  }

  console.log(`\n=== ИТОГО: ${grandCreated} твинов, ${r2(grandAmount)}₽; пропущено периодов (двойной счёт): ${grandSkipped} ===`)
  if (!APPLY) console.log("DRY-RUN — ничего не записано. Для применения: APPLY=1")
}

main()
  .catch((err) => {
    console.error("Ошибка:", err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
