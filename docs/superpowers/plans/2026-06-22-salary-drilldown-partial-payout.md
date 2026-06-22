# Детализация ЗП преподавателя + частичная выплата по направлениям — План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** На `/salary` по клику на ФИО открывать детализацию начислений преподавателя (по направлениям с раскрытием в занятия) и проводить частичную выплату двумя кнопками — «Выплатить аванс» (до 15-го) и «Выплатить остатки».

**Architecture:** Чистая функция агрегации `buildInstructorSalaryDetail` (юнит-тест) → новый `GET /api/salary/instructor/[id]` → server-страница + клиентский компонент детализации + диалог выплаты. Выплата переиспользует существующий `POST /api/salary-payments` (режим `items[]` + `periodHalf`). Схема Prisma не меняется — факт фиксируется в `SalaryPaymentItem.directionId`.

**Tech Stack:** Next.js 15 (App Router), Prisma, TypeScript, shadcn/ui, node:test + tsx (юнит).

**Спека:** `docs/superpowers/specs/2026-06-22-salary-drilldown-partial-payout-design.md`

**Команды проверки:**
- Юнит одного файла: `cd app && node --import tsx --test src/__tests__/instructor-salary-detail.test.ts`
- Типы: `cd app && npx tsc --noEmit`

---

## Файловая структура

- Создать `app/src/lib/salary/instructor-detail.ts` — типы + чистая функция `buildInstructorSalaryDetail`.
- Создать `app/src/__tests__/instructor-salary-detail.test.ts` — юнит-тесты функции.
- Создать `app/src/app/api/salary/instructor/[employeeId]/route.ts` — GET-эндпоинт.
- Создать `app/src/app/(dashboard)/salary/instructor/[employeeId]/page.tsx` — server-shell.
- Создать `app/src/app/(dashboard)/salary/instructor/[employeeId]/instructor-detail-client.tsx` — клиентский компонент (таблица + drill-down + 2 кнопки).
- Создать `app/src/app/(dashboard)/salary/instructor/[employeeId]/pay-by-direction-dialog.tsx` — диалог выплаты (mode = advance|remainder).
- Изменить `app/src/app/(dashboard)/salary/page.tsx` — ФИО → ссылка на детализацию.
- Изменить `app/src/lib/page-help-content.ts` — ключ справки `salary/instructor`.

---

## Task 1: Чистая функция агрегации `buildInstructorSalaryDetail`

**Files:**
- Create: `app/src/lib/salary/instructor-detail.ts`
- Test: `app/src/__tests__/instructor-salary-detail.test.ts`

- [ ] **Step 1: Написать падающий тест**

`app/src/__tests__/instructor-salary-detail.test.ts`:

```ts
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildInstructorSalaryDetail } from "../lib/salary/instructor-detail"

// Хелпер отметки: дата занятия задаёт «до 15-го» (день <= 15).
function att(lessonId: string, day: number, dirId: string | null, dirName: string, amount: number) {
  return {
    lessonId,
    date: new Date(Date.UTC(2026, 5, day)), // июнь 2026
    groupName: "Гр",
    directionId: dirId,
    directionName: dirName,
    typeName: "Был",
    instructorPayAmount: amount,
  }
}

describe("buildInstructorSalaryDetail", () => {
  it("разносит начисления по направлениям, считает до-15-го, остаток и итоги", () => {
    const res = buildInstructorSalaryDetail({
      attendances: [
        att("l1", 5, "d1", "Рисование", 720),   // до 15-го
        att("l1", 5, "d1", "Рисование", 600),   // та же l1 → 1 занятие, 2 ученика
        att("l2", 20, "d1", "Рисование", 600),  // после 15-го
        att("l3", 7, "d2", "Английский", 480),  // до 15-го
      ],
      adjustments: [
        { type: "bonus", amount: 2000 },
        { type: "penalty", amount: 500 },
      ],
      paymentItems: [
        { directionId: "d1", amount: 1000 },    // уже выплачено по Рисованию
        { directionId: null, amount: 300 },     // выплата без направления (legacy)
      ],
      salaried: null,
    })

    const draw = res.byDirection.find((d) => d.directionId === "d1")!
    assert.equal(draw.accrued, 1920)            // 720+600+600
    assert.equal(draw.accruedFirstHalf, 1320)   // 720+600 (день 5), без дня 20
    assert.equal(draw.paid, 1000)
    assert.equal(draw.remaining, 920)           // 1920-1000
    assert.equal(draw.lessonCount, 2)           // l1, l2

    assert.equal(res.adjustments.net, 1500)             // 2000-500
    assert.equal(res.adjustments.paidNoDirection, 300)
    assert.equal(res.adjustments.remaining, 1200)       // 1500-300

    assert.equal(res.totals.accrued, 2400)              // 1920 + 480
    assert.equal(res.totals.paid, 1300)                 // 1000 + 300
    assert.equal(res.totals.remaining, 2600)            // 2400 + 2000 - 500 - 1300

    // Занятия: l1 агрегировано (2 ученика, 1320), отсортированы по дате asc
    const l1 = res.lessons.find((l) => l.lessonId === "l1")!
    assert.equal(l1.studentsCharged, 2)
    assert.equal(l1.amount, 1320)
  })

  it("окладник: accrued = оклад, accruedFirstHalf = половина оклада", () => {
    const res = buildInstructorSalaryDetail({
      attendances: [],
      adjustments: [],
      paymentItems: [],
      salaried: { monthlySalary: 40000, defaultDirectionId: "d9", defaultDirectionName: "Менеджмент" },
    })
    const d = res.byDirection.find((x) => x.directionId === "d9")!
    assert.equal(d.accrued, 40000)
    assert.equal(d.accruedFirstHalf, 20000)
    assert.equal(res.totals.accrued, 40000)
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd app && node --import tsx --test src/__tests__/instructor-salary-detail.test.ts`
Expected: FAIL — `Cannot find module '../lib/salary/instructor-detail'`.

- [ ] **Step 3: Реализовать функцию**

`app/src/lib/salary/instructor-detail.ts`:

```ts
// Чистая агрегация детализации ЗП преподавателя за период. Без БД — для юнит-тестов
// и переиспользования в GET /api/salary/instructor/[id].
//
// Семантика: начисления (Attendance.instructorPayAmount) разносятся по направлению
// занятия; «до 15-го» — занятия с днём <= 15 (пресет аванса). Выплаты берутся из
// SalaryPaymentItem: per-direction по directionId, прочие (legacy/простые) — в
// строку «Премии−штрафы» (paidNoDirection). Окладник добавляется строкой по
// defaultDirection: accrued = оклад, accruedFirstHalf = половина оклада.

export interface AttendanceInput {
  lessonId: string
  date: Date
  groupName: string
  directionId: string | null
  directionName: string
  typeName: string
  instructorPayAmount: number
}

export interface AdjustmentInput {
  type: "bonus" | "penalty"
  amount: number
}

export interface PaymentItemInput {
  directionId: string | null
  amount: number
}

export interface SalariedInput {
  monthlySalary: number
  defaultDirectionId: string | null
  defaultDirectionName: string
}

export interface DirectionDetail {
  directionId: string | null
  directionName: string
  accrued: number
  accruedFirstHalf: number
  paid: number
  remaining: number
  lessonCount: number
}

export interface LessonDetail {
  lessonId: string
  date: string // yyyy-MM-dd
  groupName: string
  directionId: string | null
  directionName: string
  typeName: string
  studentsCharged: number
  amount: number
}

export interface InstructorSalaryDetail {
  byDirection: DirectionDetail[]
  adjustments: {
    bonuses: number
    penalties: number
    net: number
    paidNoDirection: number
    remaining: number
  }
  lessons: LessonDetail[]
  totals: {
    accrued: number
    accruedFirstHalf: number
    bonuses: number
    penalties: number
    paid: number
    remaining: number
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const NO_DIR = "__no_direction__"

export function buildInstructorSalaryDetail(params: {
  attendances: AttendanceInput[]
  adjustments: AdjustmentInput[]
  paymentItems: PaymentItemInput[]
  salaried: SalariedInput | null
}): InstructorSalaryDetail {
  const { attendances, adjustments, paymentItems, salaried } = params

  // --- Начисления по направлениям + множество занятий ---
  type Acc = { directionId: string | null; directionName: string; accrued: number; accruedFirstHalf: number; lessons: Set<string> }
  const byDir = new Map<string, Acc>()
  const getAcc = (id: string | null, name: string): Acc => {
    const key = id ?? NO_DIR
    let a = byDir.get(key)
    if (!a) { a = { directionId: id, directionName: name, accrued: 0, accruedFirstHalf: 0, lessons: new Set() }; byDir.set(key, a) }
    return a
  }

  for (const a of attendances) {
    const acc = getAcc(a.directionId, a.directionName)
    acc.accrued += a.instructorPayAmount
    if (a.date.getUTCDate() <= 15) acc.accruedFirstHalf += a.instructorPayAmount
    acc.lessons.add(a.lessonId)
  }

  // Окладник: оклад на defaultDirection; половина — в «до 15-го».
  if (salaried && salaried.monthlySalary > 0) {
    const acc = getAcc(salaried.defaultDirectionId, salaried.defaultDirectionName || "Без направления")
    acc.accrued += salaried.monthlySalary
    acc.accruedFirstHalf += salaried.monthlySalary / 2
  }

  // --- Выплаты: per-direction и без направления ---
  const paidByDir = new Map<string, number>()
  let paidNoDirection = 0
  for (const it of paymentItems) {
    if (it.directionId == null) paidNoDirection += it.amount
    else paidByDir.set(it.directionId, (paidByDir.get(it.directionId) || 0) + it.amount)
  }

  const byDirection: DirectionDetail[] = Array.from(byDir.values())
    .map((a) => {
      const paid = a.directionId == null ? 0 : (paidByDir.get(a.directionId) || 0)
      return {
        directionId: a.directionId,
        directionName: a.directionName,
        accrued: r2(a.accrued),
        accruedFirstHalf: r2(a.accruedFirstHalf),
        paid: r2(paid),
        remaining: r2(a.accrued - paid),
        lessonCount: a.lessons.size,
      }
    })
    .sort((x, y) => y.accrued - x.accrued)

  // --- Корректировки ---
  const bonuses = adjustments.filter((a) => a.type === "bonus").reduce((s, a) => s + a.amount, 0)
  const penalties = adjustments.filter((a) => a.type === "penalty").reduce((s, a) => s + a.amount, 0)
  const net = bonuses - penalties

  // --- Занятия (per-lesson) ---
  type L = { lessonId: string; date: Date; groupName: string; directionId: string | null; directionName: string; typeName: string; studentsCharged: number; amount: number }
  const lessonsMap = new Map<string, L>()
  for (const a of attendances) {
    let l = lessonsMap.get(a.lessonId)
    if (!l) {
      l = { lessonId: a.lessonId, date: a.date, groupName: a.groupName, directionId: a.directionId, directionName: a.directionName, typeName: a.typeName, studentsCharged: 0, amount: 0 }
      lessonsMap.set(a.lessonId, l)
    }
    l.studentsCharged += 1
    l.amount += a.instructorPayAmount
  }
  const lessons: LessonDetail[] = Array.from(lessonsMap.values())
    .sort((x, y) => x.date.getTime() - y.date.getTime())
    .map((l) => ({
      lessonId: l.lessonId,
      date: l.date.toISOString().slice(0, 10),
      groupName: l.groupName,
      directionId: l.directionId,
      directionName: l.directionName,
      typeName: l.typeName,
      studentsCharged: l.studentsCharged,
      amount: r2(l.amount),
    }))

  // --- Итоги ---
  const accruedTotal = byDirection.reduce((s, d) => s + d.accrued, 0)
  const accruedFirstHalfTotal = byDirection.reduce((s, d) => s + d.accruedFirstHalf, 0)
  const paidTotal = paymentItems.reduce((s, it) => s + it.amount, 0)

  return {
    byDirection,
    adjustments: {
      bonuses: r2(bonuses),
      penalties: r2(penalties),
      net: r2(net),
      paidNoDirection: r2(paidNoDirection),
      remaining: r2(net - paidNoDirection),
    },
    lessons,
    totals: {
      accrued: r2(accruedTotal),
      accruedFirstHalf: r2(accruedFirstHalfTotal),
      bonuses: r2(bonuses),
      penalties: r2(penalties),
      paid: r2(paidTotal),
      remaining: r2(accruedTotal + bonuses - penalties - paidTotal),
    },
  }
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `cd app && node --import tsx --test src/__tests__/instructor-salary-detail.test.ts`
Expected: PASS (2 теста).

- [ ] **Step 5: Коммит**

```bash
git add app/src/lib/salary/instructor-detail.ts app/src/__tests__/instructor-salary-detail.test.ts
git commit -m "feat(salary): чистая агрегация детализации ЗП по направлениям + тесты"
```

---

## Task 2: GET `/api/salary/instructor/[employeeId]`

**Files:**
- Create: `app/src/app/api/salary/instructor/[employeeId]/route.ts`

- [ ] **Step 1: Реализовать эндпоинт**

`app/src/app/api/salary/instructor/[employeeId]/route.ts`:

```ts
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
```

- [ ] **Step 2: Проверить типы**

Run: `cd app && npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Коммит**

```bash
git add "app/src/app/api/salary/instructor/[employeeId]/route.ts"
git commit -m "feat(salary): GET /api/salary/instructor/[id] — детализация по направлениям"
```

---

## Task 3: ФИО на `/salary` → ссылка на детализацию

**Files:**
- Modify: `app/src/app/(dashboard)/salary/page.tsx` (рендер ФИО в строке ведомости)

- [ ] **Step 1: Сделать ФИО ссылкой**

В `app/src/app/(dashboard)/salary/page.tsx` заменить блок (внутри `<TableCell className="font-medium">`):

```tsx
                    <TableCell className="font-medium">
                      {r.name}
                      {r.substitutions > 0 && (
                        <Badge variant="secondary" className="ml-2 text-xs">замена ({r.substitutions})</Badge>
                      )}
                    </TableCell>
```

на:

```tsx
                    <TableCell className="font-medium">
                      <Link
                        href={`/salary/instructor/${r.id}?year=${year}&month=${month}`}
                        className="text-primary hover:underline"
                      >
                        {r.name}
                      </Link>
                      {r.substitutions > 0 && (
                        <Badge variant="secondary" className="ml-2 text-xs">замена ({r.substitutions})</Badge>
                      )}
                    </TableCell>
```

(`Link` уже импортирован в этом файле — строка 8.)

- [ ] **Step 2: Проверить типы**

Run: `cd app && npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Коммит**

```bash
git add "app/src/app/(dashboard)/salary/page.tsx"
git commit -m "feat(salary): ФИО в ведомости — ссылка на детализацию преподавателя"
```

---

## Task 4: Server-страница детализации

**Files:**
- Create: `app/src/app/(dashboard)/salary/instructor/[employeeId]/page.tsx`

- [ ] **Step 1: Реализовать страницу-shell**

`app/src/app/(dashboard)/salary/instructor/[employeeId]/page.tsx`:

```tsx
import { getMonthFromParams } from "@/lib/month-params"
import { InstructorDetailClient } from "./instructor-detail-client"

export default async function InstructorSalaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { employeeId } = await params
  const { year, month } = getMonthFromParams(await searchParams)
  return <InstructorDetailClient employeeId={employeeId} year={year} month={month} />
}
```

- [ ] **Step 2: Проверить типы (после Task 5 клиент появится; пока ожидаемо — модуль не найден)**

Примечание: tsc пройдёт только после Task 5. Коммит — в конце Task 5 вместе с клиентом. Здесь коммита нет.

---

## Task 5: Клиентский компонент детализации (таблица + drill-down + 2 кнопки)

**Files:**
- Create: `app/src/app/(dashboard)/salary/instructor/[employeeId]/instructor-detail-client.tsx`

- [ ] **Step 1: Реализовать компонент**

`app/src/app/(dashboard)/salary/instructor/[employeeId]/instructor-detail-client.tsx`:

```tsx
"use client"

import { useEffect, useState, useCallback, Fragment } from "react"
import Link from "next/link"
import { ArrowLeft, ChevronRight, ChevronDown } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PayByDirectionDialog } from "./pay-by-direction-dialog"

interface DirectionDetail {
  directionId: string | null
  directionName: string
  accrued: number
  accruedFirstHalf: number
  paid: number
  remaining: number
  lessonCount: number
}
interface LessonDetail {
  lessonId: string
  date: string
  groupName: string
  directionId: string | null
  directionName: string
  typeName: string
  studentsCharged: number
  amount: number
}
export interface InstructorDetailData {
  employee: { id: string; name: string; role: string }
  periodYear: number
  periodMonth: number
  canPay: boolean
  periodLocked: boolean
  accounts: { id: string; name: string }[]
  byDirection: DirectionDetail[]
  adjustments: { bonuses: number; penalties: number; net: number; paidNoDirection: number; remaining: number }
  lessons: LessonDetail[]
  totals: { accrued: number; accruedFirstHalf: number; bonuses: number; penalties: number; paid: number; remaining: number }
}

const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n * 100) / 100) + " ₽"

export function InstructorDetailClient({ employeeId, year, month }: { employeeId: string; year: number; month: number }) {
  const [data, setData] = useState<InstructorDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/salary/instructor/${employeeId}?periodYear=${year}&periodMonth=${month}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Ошибка загрузки")
        return
      }
      setData(await res.json())
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }, [employeeId, year, month])

  useEffect(() => { load() }, [load])

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  if (loading) return <p className="text-sm text-muted-foreground">Загрузка…</p>
  if (error) return <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
  if (!data) return null

  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={`/salary?year=${year}&month=${month}`} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{data.employee.name}</h1>
            <p className="text-sm text-muted-foreground">Детализация ЗП — {monthName}</p>
          </div>
        </div>
        {data.canPay && (
          <div className="flex items-center gap-2">
            <PayByDirectionDialog mode="advance" data={data} onPaid={load} />
            <PayByDirectionDialog mode="remainder" data={data} onPaid={load} />
          </div>
        )}
      </div>

      {data.periodLocked && (
        <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-200">
          Период закрыт — выплаты недоступны.
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Направление</TableHead>
                <TableHead className="text-right">Начислено</TableHead>
                <TableHead className="text-right">до 15-го (аванс)</TableHead>
                <TableHead className="text-right">Выплачено</TableHead>
                <TableHead className="text-right">Остаток</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byDirection.length === 0 && data.adjustments.net === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Нет начислений за период</TableCell></TableRow>
              )}
              {data.byDirection.map((d) => {
                const key = d.directionId ?? "__no_direction__"
                const isOpen = expanded.has(key)
                const dirLessons = data.lessons.filter((l) => (l.directionId ?? "__no_direction__") === key)
                return (
                  <Fragment key={key}>
                    <TableRow className="cursor-pointer" onClick={() => toggle(key)}>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1">
                          {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          {d.directionName}
                          <span className="text-xs text-muted-foreground">({d.lessonCount} зан.)</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{fmt(d.accrued)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmt(d.accruedFirstHalf)}</TableCell>
                      <TableCell className="text-right text-purple-600">{d.paid > 0 ? fmt(d.paid) : "—"}</TableCell>
                      <TableCell className={`text-right font-medium ${d.remaining > 0 ? "text-orange-600" : ""}`}>{fmt(d.remaining)}</TableCell>
                    </TableRow>
                    {isOpen && dirLessons.map((l) => (
                      <TableRow key={l.lessonId} className="bg-muted/30 text-sm">
                        <TableCell className="pl-9 text-muted-foreground" colSpan={4}>
                          {new Date(l.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })} · {l.groupName} · {l.typeName} · {l.studentsCharged} уч.
                        </TableCell>
                        <TableCell className="text-right">{fmt(l.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                )
              })}
              {data.adjustments.net !== 0 && (
                <TableRow>
                  <TableCell className="font-medium">Премии − штрафы <span className="text-xs text-muted-foreground">(без направления)</span></TableCell>
                  <TableCell className="text-right">{fmt(data.adjustments.net)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">—</TableCell>
                  <TableCell className="text-right text-purple-600">{data.adjustments.paidNoDirection > 0 ? fmt(data.adjustments.paidNoDirection) : "—"}</TableCell>
                  <TableCell className={`text-right font-medium ${data.adjustments.remaining > 0 ? "text-orange-600" : ""}`}>{fmt(data.adjustments.remaining)}</TableCell>
                </TableRow>
              )}
              <TableRow className="font-bold">
                <TableCell>Итого</TableCell>
                <TableCell className="text-right">{fmt(data.totals.accrued)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{fmt(data.totals.accruedFirstHalf)}</TableCell>
                <TableCell className="text-right text-purple-600">{data.totals.paid > 0 ? fmt(data.totals.paid) : "—"}</TableCell>
                <TableCell className="text-right">{fmt(data.totals.remaining)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Проверить типы (PayByDirectionDialog появится в Task 6 — пока tsc может ругаться на этот импорт; завершить вместе с Task 6)**

Примечание: коммит Task 4+5+6 — единый, в конце Task 6 (страница и компоненты ссылаются друг на друга).

---

## Task 6: Диалог выплаты `PayByDirectionDialog` (аванс/остатки)

**Files:**
- Create: `app/src/app/(dashboard)/salary/instructor/[employeeId]/pay-by-direction-dialog.tsx`

- [ ] **Step 1: Реализовать диалог**

`app/src/app/(dashboard)/salary/instructor/[employeeId]/pay-by-direction-dialog.tsx`:

```tsx
"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Banknote } from "lucide-react"
import type { InstructorDetailData } from "./instructor-detail-client"

const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n * 100) / 100) + " ₽"
const NO_DIR = "__no_direction__"

interface Row {
  key: string
  directionId: string | null
  name: string
  remaining: number   // остаток (для предупреждения о переплате)
  preset: number      // пресет суммы по режиму
  checked: boolean
  amount: string
}

export function PayByDirectionDialog({
  mode, data, onPaid,
}: {
  mode: "advance" | "remainder"
  data: InstructorDetailData
  onPaid: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accountId, setAccountId] = useState("")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState<Row[]>([])

  // Пересобираем строки при открытии — пресет по режиму.
  function buildRows(): Row[] {
    const dirRows: Row[] = data.byDirection.map((d) => {
      const preset = mode === "advance"
        ? Math.max(0, d.accruedFirstHalf - d.paid)
        : Math.max(0, d.remaining)
      return {
        key: d.directionId ?? NO_DIR,
        directionId: d.directionId,
        name: d.directionName,
        remaining: d.remaining,
        preset: Math.round(preset * 100) / 100,
        checked: preset > 0,
        amount: String(Math.round(preset * 100) / 100),
      }
    })
    // Строка «Премии − штрафы» (directionId=null) — только для остатков по умолчанию.
    if (data.adjustments.net !== 0) {
      const preset = mode === "remainder" ? Math.max(0, data.adjustments.remaining) : 0
      dirRows.push({
        key: "__adjustments__",
        directionId: null,
        name: "Премии − штрафы",
        remaining: data.adjustments.remaining,
        preset: Math.round(preset * 100) / 100,
        checked: preset > 0,
        amount: String(Math.round(preset * 100) / 100),
      })
    }
    return dirRows
  }

  function handleOpen(v: boolean) {
    setOpen(v)
    if (v) {
      setRows(buildRows())
      setAccountId(data.accounts[0]?.id ?? "")
      setDate(new Date().toISOString().slice(0, 10))
      setError(null)
    }
  }

  function setRowAmount(key: string, value: string) {
    setRows((prev) => prev.map((r) => r.key === key ? { ...r, amount: value } : r))
  }
  function toggleRow(key: string) {
    setRows((prev) => prev.map((r) => r.key === key ? { ...r, checked: !r.checked } : r))
  }

  const total = useMemo(
    () => rows.filter((r) => r.checked).reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [rows],
  )
  const overpay = rows.some((r) => r.checked && (Number(r.amount) || 0) > r.remaining + 0.001)

  async function handleSubmit() {
    setError(null)
    if (!accountId) { setError("Выберите счёт"); return }
    const items = rows
      .filter((r) => r.checked && Number(r.amount) > 0)
      .map((r) => ({ employeeId: data.employee.id, accountId, directionId: r.directionId, amount: Number(r.amount) }))
    if (items.length === 0) { setError("Отметьте хотя бы одно направление с суммой"); return }

    setLoading(true)
    try {
      const res = await fetch("/api/salary-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          periodYear: data.periodYear,
          periodMonth: data.periodMonth,
          periodHalf: mode === "advance" ? 1 : 2,
          comment: mode === "advance" ? "Аванс" : "Остатки ЗП",
          items,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Ошибка при выплате")
        return
      }
      setOpen(false)
      onPaid()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const title = mode === "advance" ? "Выплатить аванс" : "Выплатить остатки"
  const selectedAccount = data.accounts.find((a) => a.id === accountId)

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={<Button variant={mode === "advance" ? "outline" : "default"} disabled={data.periodLocked} />}>
        <Banknote className="mr-2 size-4" />
        {title}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title} — {data.employee.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

          <div className="rounded-md border divide-y">
            {rows.map((r) => {
              const over = r.checked && (Number(r.amount) || 0) > r.remaining + 0.001
              return (
                <div key={r.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <input type="checkbox" checked={r.checked} onChange={() => toggleRow(r.key)} className="size-4" />
                  <span className="flex-1">{r.name}</span>
                  <span className="text-xs text-muted-foreground">ост. {fmt(r.remaining)}</span>
                  <Input
                    type="number" step="0.01" min="0"
                    value={r.amount}
                    onChange={(e) => setRowAmount(r.key, e.target.value)}
                    disabled={!r.checked}
                    className={`w-28 text-right ${over ? "border-orange-400" : ""}`}
                  />
                </div>
              )
            })}
          </div>

          {overpay && (
            <p className="text-xs text-orange-600">Внимание: по некоторым строкам сумма больше остатка (аванс/переплата).</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Счёт *</Label>
              <Select value={accountId} onValueChange={(v) => { if (v) setAccountId(v) }}>
                <SelectTrigger className="w-full">{selectedAccount ? selectedAccount.name : "Выберите счёт"}</SelectTrigger>
                <SelectContent>
                  {data.accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Дата *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between text-base font-bold">
            <span>Итого к выплате:</span>
            <span>{fmt(total)}</span>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Отмена</Button>
            <Button onClick={handleSubmit} disabled={loading || total <= 0}>
              {loading ? "Выплата…" : `Выплатить ${fmt(total)}`}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Проверить типы (теперь все три файла Task 4–6 на месте)**

Run: `cd app && npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Коммит (страница + клиент + диалог)**

```bash
git add "app/src/app/(dashboard)/salary/instructor/[employeeId]/page.tsx" \
        "app/src/app/(dashboard)/salary/instructor/[employeeId]/instructor-detail-client.tsx" \
        "app/src/app/(dashboard)/salary/instructor/[employeeId]/pay-by-direction-dialog.tsx"
git commit -m "feat(salary): страница детализации ЗП + диалог частичной выплаты (аванс/остатки)"
```

---

## Task 7: PageHelp для страницы детализации

**Files:**
- Modify: `app/src/lib/page-help-content.ts` (добавить ключ); компонент `<PageHelp>` уже подключается в шапке — добавим в `instructor-detail-client.tsx`.

- [ ] **Step 1: Добавить ключ справки**

В `app/src/lib/page-help-content.ts` добавить новый ключ в объект контента (рядом с ключом `"salary"`):

```ts
  "salary/instructor": {
    title: "Детализация ЗП преподавателя",
    subtitle: "За что начислено и частичная выплата по направлениям",
    sections: [
      {
        heading: "Что показывает",
        text: "Начисления преподавателя за период, разнесённые по направлениям. Строка направления раскрывается в список занятий: дата, группа, вид дня, число оплачиваемых учеников, сумма ЗП. Колонка «до 15-го» — начисления по занятиям первой половины месяца (для аванса). «Премии − штрафы» — корректировки без направления.",
      },
      {
        heading: "Аванс и остатки",
        items: [
          "«Выплатить аванс» — сумма по умолчанию = начислено до 15-го включительно минус уже выплаченное (можно скорректировать)",
          "«Выплатить остатки» — сумма по умолчанию = полный остаток (начислено − выплачено)",
          "Чекбоксами выбираются направления к выплате; сумму по каждому можно изменить; переплата выше остатка разрешена с предупреждением",
          "Выплата фиксируется по направлениям и сразу отражается в «Выплачено»/«Осталось» и в ДДС/ОПИУ",
        ],
      },
    ],
  },
```

- [ ] **Step 2: Подключить `<PageHelp>` на странице**

В `instructor-detail-client.tsx` добавить импорт и компонент рядом с `<h1>`:

Импорт (вверху, рядом с другими `@/components`):
```tsx
import { PageHelp } from "@/components/page-help"
```

Заменить заголовок:
```tsx
            <h1 className="text-2xl font-bold">{data.employee.name}</h1>
```
на:
```tsx
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{data.employee.name}</h1>
              <PageHelp pageKey="salary/instructor" />
            </div>
```

- [ ] **Step 3: Проверить типы + юнит**

Run: `cd app && npx tsc --noEmit && node --import tsx --test src/__tests__/instructor-salary-detail.test.ts`
Expected: tsc без ошибок; юнит — PASS.

- [ ] **Step 4: Коммит**

```bash
git add app/src/lib/page-help-content.ts "app/src/app/(dashboard)/salary/instructor/[employeeId]/instructor-detail-client.tsx"
git commit -m "feat(salary): PageHelp для детализации ЗП преподавателя"
```

---

## Финальная проверка (после всех задач)

- [ ] `cd app && npx tsc --noEmit` — без ошибок.
- [ ] `cd app && node --import tsx --test src/__tests__/instructor-salary-detail.test.ts` — PASS.
- [ ] Ручная проверка (dev): открыть `/salary`, кликнуть ФИО → детализация; раскрыть направление → занятия; «Выплатить аванс» → пресет до-15-го, скорректировать, выплатить; вернуться на `/salary` — «Выплачено»/«Осталось» обновились; «Выплатить остатки» — остаток.
- [ ] Push в `main`, проверить CI (`gh run list --repo denshimansky/crmka --limit 2`), дождаться зелёного деплоя.

## Самопроверка плана (выполнена при написании)

- **Покрытие спеки:** drill-down по направлениям с раскрытием (Task 5), колонка «до 15-го» (Task 1/5), 2 кнопки аванс/остатки с пресетами и periodHalf (Task 6), переплата-предупреждение (Task 6), «Премии−штрафы» строкой (Task 1/5/6), фиксация через items.directionId (Task 6, переиспуск POST), доступ own/owner-manager (Task 2), PageHelp (Task 7). ✓
- **Плейсхолдеров нет:** весь код приведён полностью. ✓
- **Согласованность типов:** `InstructorDetailData`/`DirectionDetail`/`LessonDetail` экспортируются из клиента и импортируются в диалог; поля совпадают с выводом эндпоинта (`...detail` + `employee/periodYear/periodMonth/canPay/periodLocked/accounts`). Чистая функция возвращает ровно те поля, что использует UI. ✓
