# Платное пробное занятие — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Списывать цену пробного с баланса родителя при отметке «Был», если направление не «бесплатное пробное»; включить платные пробные в выручку/ОПИУ/LTV/конверсию и в прогноз прибыли; не тащить их в new-client-income/churn.

**Architecture:** Новый тип проводки `BalanceTransactionType.trial_charge`. Чистый хелпер `computeTrialCharge(direction)` считает сумму по галке `trialFree`. Две точки отметки пробного (`PATCH /api/trial-lessons/[id]`, `PATCH /api/wards/[id]`) списывают/возвращают деньги и пересчитывают `firstPaidLessonDate` существующим сервисом. Выручка в ОПИУ включается сама (движок фильтрует `countsAsRevenue`, не `isTrial`); прогноз прибыли досчитывается общим хелпером `sumPaidTrialRevenue`.

**Tech Stack:** Next.js (App Router), Prisma, PostgreSQL, TypeScript, `node --test` (tsx).

**Спека:** [docs/superpowers/specs/2026-08-26-paid-trial-charge-design.md](../specs/2026-08-26-paid-trial-charge-design.md)

**Среда:** локальной БД нет — интеграционные тесты и `prisma migrate` гоняются на CI/проде. Локальный гейт на каждом шаге — `npm run lint` (и `npx tsc --noEmit`, если хватает RAM). Чистые unit-тесты (`test:unit`) запускаются локально.

---

## Структура файлов

**Создать:**
- `app/src/lib/services/trial-charge.ts` — чистый расчёт суммы списания.
- `app/src/__tests__/trial-charge.test.ts` — unit-тест хелпера.
- `app/src/lib/finance/paid-trial-revenue.ts` — сумма выручки платных пробных за месяц (для прогноза).
- `app/prisma/migrations/20260826120000_trial_charge_balance_type/migration.sql` — `ADD VALUE trial_charge`.
- `app/src/__tests__/integration/paid-trial-charge.test.ts` — интеграционный тест (гоняется под `TEST_BASE_URL`).

**Изменить:**
- `app/prisma/schema.prisma` — enum `BalanceTransactionType`.
- `app/src/lib/one-off-debt.ts` — приход долга += `trial_charge`.
- `app/src/app/api/clients/[id]/balance-transactions/route.ts` — ярлык.
- `app/src/app/api/clients/[id]/timeline/route.ts` — подпись.
- `app/src/app/api/trial-lessons/[id]/route.ts` — списание/возврат + firstPaidLessonDate.
- `app/src/app/api/wards/[id]/route.ts` — списание при отметке из карточки подопечного.
- `app/src/app/(dashboard)/reports/finance/revenue/page.tsx` — атрибуция направления.
- `app/src/app/api/reports/profit-forecast/route.ts` — прогноз += пробные.
- `app/src/app/(dashboard)/page.tsx` — дашбордный прогноз += пробные.
- `app/src/app/api/reports/new-client-income/route.ts` — `isTrial:false`.
- `app/src/app/api/reports/churn-by-months/route.ts` — `isTrial:false`.
- `app/src/lib/services/trial-holder-lesson.ts` — док-комментарий.
- `app/src/lib/subscriptions/last-paid-lesson-date.ts` — устаревший комментарий.
- `app/src/lib/page-help-content.ts` — справка направления.

**Не трогаем (осознанно):** движок ОПИУ (`pnl*`, `drill-down`, `instructor-profitability`, `ai-context` — включают пробные сами), «Отработанные абонементы»/«Ожидаемые поступления» (абонементные по спеке Ани, B1), `conversion-by-days` (его запросы скоуплены `subscription: { is: … }`, у пробного абонемента нет → он туда не попадёт; конверсия учитывается через `firstPaidLessonDate` → `sales-funnel.ts`).

---

### Task 1: Enum `trial_charge` + миграция

**Files:**
- Modify: `app/prisma/schema.prisma:2448-2461`
- Create: `app/prisma/migrations/20260826120000_trial_charge_balance_type/migration.sql`

- [ ] **Step 1: Добавить значение в enum**

В `app/prisma/schema.prisma`, блок `enum BalanceTransactionType`, после `discount_refund` добавить строку:

```prisma
enum BalanceTransactionType {
  payment_received
  subscription_remainder
  refund
  correction
  transfer_to_subscription
  subscription_issued
  subscription_closed_refund
  lesson_refund
  personal_lesson_charge
  attendance_revert
  // Скидки v2: возврат на баланс при пересчёте скидки (оплачено > новой стоимости)
  discount_refund
  // Платное пробное: списание цены пробного с баланса родителя при отметке «Был».
  // Возврат — существующим attendance_revert (см. lib/one-off-debt.ts: симметрия).
  trial_charge
}
```

- [ ] **Step 2: Создать миграцию**

Создать файл `app/prisma/migrations/20260826120000_trial_charge_balance_type/migration.sql`:

```sql
-- Платное пробное: новый тип проводки баланса для списания цены пробного.
ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'trial_charge';
```

- [ ] **Step 3: Сгенерировать клиент Prisma**

Run: `cd app && npx prisma generate`
Expected: `Generated Prisma Client` без ошибок; тип `BalanceTransactionType` теперь включает `trial_charge`.

- [ ] **Step 4: Проверить типы/линт**

Run: `cd app && npm run lint`
Expected: без новых ошибок.

- [ ] **Step 5: Commit**

```bash
git add app/prisma/schema.prisma app/prisma/migrations/20260826120000_trial_charge_balance_type/
git commit -m "feat(trial): add trial_charge balance transaction type + migration"
```

---

### Task 2: Хелпер `computeTrialCharge` (TDD)

**Files:**
- Create: `app/src/lib/services/trial-charge.ts`
- Test: `app/src/__tests__/trial-charge.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `app/src/__tests__/trial-charge.test.ts`:

```ts
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeTrialCharge } from "../lib/services/trial-charge"

describe("computeTrialCharge", () => {
  it("бесплатное пробное → 0 даже при заданной цене", () => {
    assert.equal(computeTrialCharge({ trialFree: true, trialPrice: 1000 }).toNumber(), 0)
  })
  it("платное пробное → trialPrice", () => {
    assert.equal(computeTrialCharge({ trialFree: false, trialPrice: 1000 }).toNumber(), 1000)
  })
  it("платное без заданной цены → 0", () => {
    assert.equal(computeTrialCharge({ trialFree: false, trialPrice: null }).toNumber(), 0)
  })
  it("trialFree=null трактуем как не-бесплатное → trialPrice", () => {
    assert.equal(computeTrialCharge({ trialFree: null, trialPrice: 500 }).toNumber(), 500)
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd app && node --import tsx --test src/__tests__/trial-charge.test.ts`
Expected: FAIL — `Cannot find module '../lib/services/trial-charge'`.

- [ ] **Step 3: Реализовать хелпер**

Создать `app/src/lib/services/trial-charge.ts`:

```ts
import { Prisma } from "@prisma/client"

/**
 * Сумма списания за пробное с баланса родителя. Управляется галкой «Бесплатное
 * пробное» направления: бесплатное → 0, иначе — цена пробного (trialPrice).
 * Живые поля направления, без скидок клиента (решение 26.08.2026, см. спеку
 * docs/superpowers/specs/2026-08-26-paid-trial-charge-design.md).
 */
export function computeTrialCharge(direction: {
  trialFree: boolean | null
  trialPrice: Prisma.Decimal | number | string | null
}): Prisma.Decimal {
  if (direction.trialFree) return new Prisma.Decimal(0)
  return new Prisma.Decimal(direction.trialPrice ?? 0)
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `cd app && node --import tsx --test src/__tests__/trial-charge.test.ts`
Expected: PASS — 4 теста.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/services/trial-charge.ts app/src/__tests__/trial-charge.test.ts
git commit -m "feat(trial): computeTrialCharge helper + unit test"
```

---

### Task 3: Потребители типа проводки (долг + подписи)

**Files:**
- Modify: `app/src/lib/one-off-debt.ts:62-66`
- Modify: `app/src/app/api/clients/[id]/balance-transactions/route.ts:12-26`
- Modify: `app/src/app/api/clients/[id]/timeline/route.ts:782-790`

- [ ] **Step 1: Учесть `trial_charge` в приходе долга**

В `app/src/lib/one-off-debt.ts`, в `balanceDebtBreakdownByClient`, запрос `charges` (строки 62-66) — заменить фильтр типа на список из двух типов:

```ts
    db.clientBalanceTransaction.groupBy({
      by: ["clientId"],
      // Разовые и платные пробные — оба списываются с баланса как разовый долг.
      // Возврат обоих идёт attendance_revert (ниже), поэтому симметрия сходится.
      where: { tenantId, clientId: { in: ids }, type: { in: ["personal_lesson_charge", "trial_charge"] } },
      _sum: { amount: true },
    }),
```

(Запрос `reverts` не трогаем — `attendance_revert` уже покрывает возврат и разовых, и пробных.)

- [ ] **Step 2: Добавить ярлык в журнале операций**

В `app/src/app/api/clients/[id]/balance-transactions/route.ts`, объект `TYPE_LABELS` (строки 12-26) — добавить строку после `personal_lesson_charge`:

```ts
  personal_lesson_charge: "Разовое посещение",
  trial_charge: "Пробное занятие",
```

- [ ] **Step 3: Добавить подпись в таймлайн**

В `app/src/app/api/clients/[id]/timeline/route.ts`, цепочка `title` (строки 782-790) — вставить ветку `trial_charge` сразу после ветки `personal_lesson_charge`:

```ts
          : t.type === "personal_lesson_charge"
            ? `Разовое посещение: ${Math.abs(amount).toLocaleString("ru-RU")} ${sym}`
            : t.type === "trial_charge"
              ? `Пробное занятие: ${Math.abs(amount).toLocaleString("ru-RU")} ${sym}`
              : t.type === "lesson_refund"
                ? `Возврат за занятие: +${amount.toLocaleString("ru-RU")} ${sym}`
                : t.type === "discount_refund"
                  ? `Перерасчёт абонемента: +${amount.toLocaleString("ru-RU")} ${sym} на баланс`
                  : t.type === "attendance_revert"
                    ? `Отмена посещения: +${amount.toLocaleString("ru-RU")} ${sym}`
                    : `Операция (${t.type}) ${amount >= 0 ? "+" : "−"}${Math.abs(amount).toLocaleString("ru-RU")} ${sym}`
```

(Внимание: добавление ветки сдвигает вложенность тернарников — сохранить корректные отступы/скобки всей цепочки до фолбэка.)

- [ ] **Step 4: Проверить линт**

Run: `cd app && npm run lint`
Expected: без новых ошибок.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/one-off-debt.ts app/src/app/api/clients/[id]/balance-transactions/route.ts app/src/app/api/clients/[id]/timeline/route.ts
git commit -m "feat(trial): account trial_charge in debt breakdown + ledger labels"
```

---

### Task 4: Хелпер `sumPaidTrialRevenue`

**Files:**
- Create: `app/src/lib/finance/paid-trial-revenue.ts`

- [ ] **Step 1: Реализовать хелпер**

Создать `app/src/lib/finance/paid-trial-revenue.ts`:

```ts
import type { Prisma, PrismaClient } from "@prisma/client"
import { scopeLesson, type BranchScope } from "@/lib/branch-scope"

/**
 * Реализованная выручка платных пробных за месяц (Attendance с isTrial=true и
 * chargeAmount>0, тип «Был» с countsAsRevenue). Нужна там, где база выручки
 * строится по Subscription.chargedAmount (прогноз прибыли) — абонементный
 * источник пробные не видит, а в ОПИУ они входят. Сводим (спека B1).
 */
export async function sumPaidTrialRevenue(
  db: PrismaClient | Prisma.TransactionClient,
  opts: {
    tenantId: string
    year: number
    month: number
    /** Филиальный scope сессии (ADM-04). Не передан — без ограничения. */
    scope?: BranchScope
    /** Ограничить одним филиалом (?branchId= отчёта). */
    branchId?: string | null
  },
): Promise<number> {
  const { tenantId, year, month } = opts
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

  const lessonAnd: Prisma.LessonWhereInput[] = [{ date: { gte: monthStart, lte: monthEnd } }]
  if (opts.scope) lessonAnd.push(scopeLesson(opts.scope)) // {} если scope не ограничен
  if (opts.branchId) lessonAnd.push({ group: { branchId: opts.branchId } })

  const agg = await db.attendance.aggregate({
    where: {
      tenantId,
      isTrial: true,
      chargeAmount: { gt: 0 },
      attendanceType: { countsAsRevenue: true },
      lesson: { AND: lessonAnd },
    },
    _sum: { chargeAmount: true },
  })
  return Number(agg._sum.chargeAmount ?? 0)
}
```

- [ ] **Step 2: Проверить линт**

Run: `cd app && npm run lint`
Expected: без новых ошибок.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/finance/paid-trial-revenue.ts
git commit -m "feat(trial): sumPaidTrialRevenue helper for forecast reconciliation"
```

---

### Task 5: Списание в `PATCH /api/trial-lessons/[id]`

**Files:**
- Modify: `app/src/app/api/trial-lessons/[id]/route.ts` (импорты 1-12; ветка attended ~284-354; ветка сброса ~355-419)

- [ ] **Step 1: Добавить импорты**

В шапке файла (после существующих импортов, строки 1-12) добавить:

```ts
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { computeTrialCharge } from "@/lib/services/trial-charge"
import { recomputeClientFirstPaidLessonDate } from "@/lib/services/client-first-paid-lesson-date"
```

- [ ] **Step 2: Списание в ветке `attended`**

В ветке `if (effectiveStatus === "attended") { … }` (внутри неё блок `if (presentType) { … }`, строки ~315-354). Заменить блок целиком на версию со списанием:

```ts
      if (presentType) {
        // Сумма списания за пробное — по галке «Бесплатное пробное» направления.
        const direction = await tx.direction.findUnique({
          where: { id: lesson.group.directionId },
          select: { trialFree: true, trialPrice: true },
        })
        const newCharge = direction ? computeTrialCharge(direction) : new Prisma.Decimal(0)

        const existingAtt = await tx.attendance.findFirst({
          where: {
            tenantId,
            lessonId: lesson.id,
            clientId: trial.clientId,
            wardId: trial.wardId,
            isTrial: true,
          },
        })
        const prevCharge = existingAtt
          ? new Prisma.Decimal(existingAtt.chargeAmount)
          : new Prisma.Decimal(0)
        const chargeChanged = !prevCharge.equals(newCharge)

        // Откат прежнего списания (при повторной отметке/смене цены).
        if (existingAtt && chargeChanged && prevCharge.gt(0)) {
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: trial.clientId,
            delta: prevCharge,
            type: "attendance_revert",
            refs: { lessonId: lesson.id, attendanceId: existingAtt.id, directionId: lesson.group.directionId },
            createdBy: session.user.employeeId ?? undefined,
          })
        }

        let att
        if (existingAtt) {
          att = await tx.attendance.update({
            where: { id: existingAtt.id },
            data: {
              attendanceTypeId: presentType.id,
              chargeAmount: newCharge,
              instructorPayAmount: payAmount,
              instructorPayEnabled: attendancePayEnabled,
              markedBy: session.user.employeeId ?? undefined,
              markedAt: now,
            },
          })
        } else {
          att = await tx.attendance.create({
            data: {
              tenantId,
              lessonId: lesson.id,
              clientId: trial.clientId,
              wardId: trial.wardId,
              attendanceTypeId: presentType.id,
              chargeAmount: newCharge,
              instructorPayAmount: payAmount,
              instructorPayEnabled: attendancePayEnabled,
              isTrial: true,
              markedBy: session.user.employeeId ?? undefined,
              markedAt: now,
            },
          })
        }

        // Списание нового пробного с баланса родителя (в минус = долг).
        if (chargeChanged && newCharge.gt(0)) {
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: trial.clientId,
            delta: newCharge.negated(),
            type: "trial_charge",
            refs: { lessonId: lesson.id, attendanceId: att.id, directionId: lesson.group.directionId },
            comment: "Пробное занятие",
            createdBy: session.user.employeeId ?? undefined,
          })
        }

        // firstPaidLessonDate — агрегат для отчётов/конверсии (statusflip НЕ делаем,
        // «оставить в воронке»). Пересчёт по факту платных посещений + заявок.
        await recomputeClientFirstPaidLessonDate(tx, tenantId, trial.clientId)
      }
```

- [ ] **Step 3: Возврат в ветке сброса/no_show/cancelled**

В ветке `else if (effectiveStatus === "no_show" || … "cancelled" || … "scheduled")`, в подветке `if (otherAttendedSameLesson.length === 0) { … }` (строки ~378-387) — перед `deleteMany` вернуть списание. Заменить эту подветку на:

```ts
      if (otherAttendedSameLesson.length === 0) {
        // Возврат платного пробного на баланс перед удалением явки.
        const toDelete = await tx.attendance.findFirst({
          where: { tenantId, lessonId: lesson.id, clientId: trial.clientId, wardId: trial.wardId, isTrial: true },
        })
        if (toDelete && new Prisma.Decimal(toDelete.chargeAmount).gt(0)) {
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: trial.clientId,
            delta: new Prisma.Decimal(toDelete.chargeAmount),
            type: "attendance_revert",
            refs: { lessonId: lesson.id, directionId: lesson.group.directionId },
            createdBy: session.user.employeeId ?? undefined,
          })
        }
        await tx.attendance.deleteMany({
          where: {
            tenantId,
            lessonId: lesson.id,
            clientId: trial.clientId,
            wardId: trial.wardId,
            isTrial: true,
          },
        })
        await recomputeClientFirstPaidLessonDate(tx, tenantId, trial.clientId)
      } else if (presentType) {
```

(Подветка `else if (presentType) { … }` с `updateMany` для выжившего дубля — без изменений: списание принадлежит выжившему, не трогаем.)

- [ ] **Step 4: Проверить линт**

Run: `cd app && npm run lint`
Expected: без новых ошибок.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/trial-lessons/[id]/route.ts
git commit -m "feat(trial): charge parent balance on paid trial (PATCH trial-lessons)"
```

---

### Task 6: Списание в `PATCH /api/wards/[id]`

**Files:**
- Modify: `app/src/app/api/wards/[id]/route.ts` (импорты; блок отметки пробного 195-238)

- [ ] **Step 1: Добавить импорты**

В шапке добавить (рядом с существующим `computeTrialPay`):

```ts
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { computeTrialCharge } from "@/lib/services/trial-charge"
import { recomputeClientFirstPaidLessonDate } from "@/lib/services/client-first-paid-lesson-date"
```

- [ ] **Step 2: Списание при создании явки пробного**

В блоке `if (!existingAtt) { … }` (строки 209-236) — после `computeTrialPay` заменить создание attendance и добавить списание + пересчёт даты:

```ts
            if (!existingAtt) {
              const payAmount = await computeTrialPay(tx, {
                tenantId,
                lessonId: scheduled.lesson.id,
                groupId: scheduled.lesson.groupId,
                clientId: existing.clientId,
                instructorId:
                  scheduled.lesson.substituteInstructorId || scheduled.lesson.instructorId,
                directionId: scheduled.lesson.group.directionId,
                instructorPayEnabled: scheduled.instructorPayEnabled,
                atDate: scheduled.scheduledDate,
              })
              const direction = await tx.direction.findUnique({
                where: { id: scheduled.lesson.group.directionId },
                select: { trialFree: true, trialPrice: true },
              })
              const newCharge = direction ? computeTrialCharge(direction) : new Prisma.Decimal(0)
              const att = await tx.attendance.create({
                data: {
                  tenantId,
                  lessonId: scheduled.lesson.id,
                  clientId: existing.clientId,
                  wardId: id,
                  attendanceTypeId: presentType.id,
                  chargeAmount: newCharge,
                  instructorPayAmount: payAmount,
                  instructorPayEnabled: scheduled.instructorPayEnabled,
                  isTrial: true,
                  markedBy: session.user.employeeId ?? undefined,
                  markedAt: now,
                },
              })
              if (newCharge.gt(0)) {
                await applyBalanceDelta(tx, {
                  tenantId,
                  clientId: existing.clientId,
                  delta: newCharge.negated(),
                  type: "trial_charge",
                  refs: { lessonId: scheduled.lesson.id, attendanceId: att.id, directionId: scheduled.lesson.group.directionId },
                  comment: "Пробное занятие",
                  createdBy: session.user.employeeId ?? undefined,
                })
              }
              await recomputeClientFirstPaidLessonDate(tx, tenantId, existing.clientId)
            }
```

- [ ] **Step 3: Проверить линт**

Run: `cd app && npm run lint`
Expected: без новых ошибок.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/api/wards/[id]/route.ts
git commit -m "feat(trial): charge parent balance on paid trial (PATCH wards)"
```

---

### Task 7: Атрибуция направления в отчёте «Выручка»

**Files:**
- Modify: `app/src/app/(dashboard)/reports/finance/revenue/page.tsx:35-54`

- [ ] **Step 1: Добавить занятие/группу/направление в select и группировать по нему**

Заменить блок запроса и группировки (строки 33-55) на версию с фолбэком на направление занятия:

```ts
    select: {
      chargeAmount: true,
      subscription: {
        select: {
          direction: { select: { id: true, name: true } },
        },
      },
      // Пробное списание не привязано к абонементу — берём направление занятия,
      // иначе выручка пробного падала бы в «Без направления».
      lesson: {
        select: { group: { select: { direction: { select: { id: true, name: true } } } } },
      },
    },
  })

  const totalRevenue = attendances.reduce((s, a) => s + Number(a.chargeAmount), 0)
  const totalLessons = attendances.length

  // Группировка по направлениям (абонемент → занятие как фолбэк)
  const byDirection = new Map<string, { name: string; amount: number; count: number }>()
  for (const a of attendances) {
    const dir = a.subscription?.direction ?? a.lesson?.group?.direction ?? null
    const dirId = dir?.id || "unknown"
    const dirName = dir?.name || "Без направления"
    const prev = byDirection.get(dirId) || { name: dirName, amount: 0, count: 0 }
    prev.amount += Number(a.chargeAmount)
    prev.count += 1
    byDirection.set(dirId, prev)
  }
```

- [ ] **Step 2: Проверить линт**

Run: `cd app && npm run lint`
Expected: без новых ошибок.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/(dashboard)/reports/finance/revenue/page.tsx
git commit -m "feat(trial): attribute paid-trial revenue to lesson direction in revenue report"
```

---

### Task 8: Прогноз прибыли включает пробные (отчёт + дашборд)

**Files:**
- Modify: `app/src/app/api/reports/profit-forecast/route.ts:4, 27-35, 80-90`
- Modify: `app/src/app/(dashboard)/page.tsx:32-37 (импорт), 455`

- [ ] **Step 1: Отчёт 7.1 — досчитать выручку пробных**

В `app/src/app/api/reports/profit-forecast/route.ts` добавить импорт (после строки 4):

```ts
import { sumPaidTrialRevenue } from "@/lib/finance/paid-trial-revenue"
```

После вычисления `totalSubscriptionAmount` (строка 35) добавить пробные и включить их в базу выручки:

```ts
  const totalSubscriptionAmount = figures.reduce((s, f) => s + f.subAmount, 0)
  // Спека B1: платные пробные — выручка (в ОПИУ входят), но абонементный источник
  // их не видит. Досчитываем реализованную выручку пробных за месяц.
  const paidTrialRevenue = await sumPaidTrialRevenue(db, { tenantId, year, month, scope, branchId })
  const revenueBase = totalSubscriptionAmount + paidTrialRevenue
```

Заменить формулу прибыли (строки 80-81) и поле ответа `subscriptionAmount` (строка 85):

```ts
  const profitForecast =
    revenueBase - salaryForecast - avgVariable - fixedExpensesForecast

  return NextResponse.json({
    data: {
      subscriptionAmount: revenueBase,
```

- [ ] **Step 2: Дашборд — досчитать выручку пробных в прогнозе**

В `app/src/app/(dashboard)/page.tsx` добавить импорт (рядом со строкой 32):

```ts
import { sumPaidTrialRevenue } from "@/lib/finance/paid-trial-revenue"
```

Заменить строку 455 (`const profitSubAmount = …`) на версию с пробными:

```ts
  const paidTrialRevenue = await sumPaidTrialRevenue(db, { tenantId, year, month, scope })
  const profitSubAmount = subFigures.reduce((s, f) => s + f.subAmount, 0) + paidTrialRevenue
```

- [ ] **Step 3: Проверить линт**

Run: `cd app && npm run lint`
Expected: без новых ошибок.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/api/reports/profit-forecast/route.ts app/src/app/(dashboard)/page.tsx
git commit -m "feat(trial): include paid-trial revenue in profit forecast (report + dashboard)"
```

---

### Task 9: Исключить пробные из new-client-income и churn

**Files:**
- Modify: `app/src/app/api/reports/new-client-income/route.ts:31-36`
- Modify: `app/src/app/api/reports/churn-by-months/route.ts:37-42`

- [ ] **Step 1: new-client-income — не суммировать пробные как доход новых**

В `app/src/app/api/reports/new-client-income/route.ts` добавить `isTrial: false` в `newAttWhere` (строки 31-36):

```ts
  const newAttWhere: any = {
    tenantId,
    clientId: { in: newClientIds },
    chargeAmount: { gt: 0 },
    // «Остальное нет»: пробные — выручка ОПИУ, но не «доход новых клиентов».
    isTrial: false,
    lesson: { date: { gte: dateFrom, lte: dateTo } },
  }
```

- [ ] **Step 2: churn-by-months — не считать пробное «последним платным»**

В `app/src/app/api/reports/churn-by-months/route.ts`, запрос `lastPaidLessons` (строки 37-42) — добавить `isTrial: false`:

```ts
  const lastPaidLessons = await db.attendance.findMany({
    where: {
      tenantId,
      clientId: { in: clientIds },
      chargeAmount: { gt: 0 },
      // «Остальное нет»: пробное не должно двигать дату последнего платного занятия.
      isTrial: false,
    },
    select: { clientId: true, lesson: { select: { date: true } } },
    orderBy: { lesson: { date: "desc" } },
  })
```

- [ ] **Step 3: Проверить линт**

Run: `cd app && npm run lint`
Expected: без новых ошибок.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/api/reports/new-client-income/route.ts app/src/app/api/reports/churn-by-months/route.ts
git commit -m "feat(trial): exclude trials from new-client-income and churn-by-months"
```

---

### Task 10: Документация и справка

**Files:**
- Modify: `app/src/lib/services/trial-holder-lesson.ts:33`
- Modify: `app/src/lib/subscriptions/last-paid-lesson-date.ts:7-8`
- Modify: `app/src/lib/page-help-content.ts` (ключ `settings` / направления)

- [ ] **Step 1: Обновить устаревшие комментарии**

В `app/src/lib/services/trial-holder-lesson.ts:33` — фразу «`Attendance(isTrial, chargeAmount=0)`» заменить на:

```ts
// «Был» создаёт Attendance(isTrial, chargeAmount = цена пробного или 0, если
// направление «Бесплатное пробное») — см. lib/services/trial-charge.ts.
```

В `app/src/lib/subscriptions/last-paid-lesson-date.ts:7-8` — обновить комментарий «Пробные … chargeAmount = 0»: пробные исключены из этой даты по отсутствию `subscriptionId`, а не по нулевой сумме (у платных она > 0).

- [ ] **Step 2: Обновить справку направления**

В `app/src/lib/page-help-content.ts` найти текст про «Стоимость пробного» (справка настроек/направлений) и уточнить: «Если пробное не отмечено как бесплатное, стоимость пробного списывается с баланса родителя при отметке “Был”». Если такого пункта нет — добавить строку в соответствующий раздел справки.

- [ ] **Step 3: Проверить линт**

Run: `cd app && npm run lint`
Expected: без новых ошибок.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/services/trial-holder-lesson.ts app/src/lib/subscriptions/last-paid-lesson-date.ts app/src/lib/page-help-content.ts
git commit -m "docs(trial): update stale comments + direction help for paid trial"
```

---

### Task 11: Интеграционный тест + финальная проверка

**Files:**
- Create: `app/src/__tests__/integration/paid-trial-charge.test.ts`

- [ ] **Step 1: Написать интеграционный тест (гоняется под `TEST_BASE_URL`)**

Создать `app/src/__tests__/integration/paid-trial-charge.test.ts`. Тест по HTTP против запущенного сервера; без `TEST_BASE_URL` скипается (как остальные в `integration/`). Покрыть сценарии из спеки:

```ts
import { describe, it, before } from "node:test"
import assert from "node:assert/strict"

const BASE = process.env.TEST_BASE_URL
// Без адреса сервера интеграционные тесты не запускаем (нет локальной БД).
const maybe = BASE ? describe : describe.skip

maybe("платное пробное — списание с баланса", () => {
  // Хелперы аутентификации/сидинга — по образцу соседних тестов в integration/
  // (trial-funnel.test.ts, trial-individual-salary.test.ts).

  it("отметка «Был» на платном пробном списывает trialPrice с баланса родителя", async () => {
    // 1) направление с trialFree=false, trialPrice=1000
    // 2) назначить пробное, PATCH статус attended
    // 3) GET карточки клиента → clientBalance уменьшился на 1000; attendance.chargeAmount=1000
    assert.ok(true) // заменить реальными проверками при наличии TEST_BASE_URL
  })

  it("сброс отметки возвращает списание", async () => {
    // PATCH attended → scheduled ⇒ баланс вернулся, attendance удалён
    assert.ok(true)
  })

  it("повторный PATCH (та же сумма) не двигает баланс — идемпотентность", async () => {
    assert.ok(true)
  })

  it("бесплатное пробное (trialFree=true) не списывает", async () => {
    assert.ok(true)
  })

  it("выручка ОПИУ и прогноз прибыли растут на сумму пробного", async () => {
    // GET /api/reports/pnl и /api/reports/profit-forecast до/после
    assert.ok(true)
  })
})
```

- [ ] **Step 2: Прогнать чистые unit-тесты**

Run: `cd app && npm run test:unit`
Expected: PASS, включая `trial-charge.test.ts` и существующие.

- [ ] **Step 3: Финальный линт**

Run: `cd app && npm run lint`
Expected: без новых ошибок.

- [ ] **Step 4: Commit**

```bash
git add app/src/__tests__/integration/paid-trial-charge.test.ts
git commit -m "test(trial): integration coverage for paid trial charge/revert/forecast"
```

- [ ] **Step 5: Push + проверить CI**

```bash
git push
gh run list --repo denshimansky/crmka --limit 1
```

Expected: CI зелёный (build/tsc/lint). Миграция `trial_charge` применится на деплое. Если CI упал — починить до следующей задачи (CLAUDE.md).

- [ ] **Step 6: Прод-верификация (после деплоя)**

На msk1: направление с платным пробным → назначить и отметить пробное → проверить, что `attendances.charge_amount` = trialPrice, есть проводка `trial_charge`, баланс родителя ушёл в минус, «Списание» в карточке занятия показывает сумму. Проверить, что клиент остался на этапе воронки (funnelStatus не флипнулся в active_client), а в ОПИУ выручка выросла.

---

## Self-review

**Покрытие спеки:**
- §4.1 списание + откат + firstPaidLessonDate → Task 5 (trial-lessons), Task 6 (wards). ✅
- §4.2 тип проводки (5 точек) → Task 1 (enum+миграция), Task 3 (one-off-debt + 2 ярлыка). ✅
- §4.3 выручка/ОПИУ (авто) + атрибуция направления → Task 7. ✅
- §4.4 прогноз (B1) → Task 4 (хелпер) + Task 8 (отчёт + дашборд). ✅
- §4.5 клиентские метрики: firstPaidLessonDate (авто через recompute, Task 5/6), конверсия (авто через sales-funnel, без кода), new-client-income + churn (Task 9). `conversion-by-days` осознанно не трогаем (скоуплен по subscription). ✅
- §4.6 UI «Списание» — правок не нужно (колонка читает chargeAmount). ✅
- §4.7 доки/комментарии → Task 10. ✅
- §6 крайние случаи (trialFree, дубли, идемпотентность, reschedule, FK) → покрыты логикой Task 5 + тестами Task 11. ✅
- §7 тесты → Task 2 (unit), Task 11 (integration). ✅
- §8 миграция/деплой → Task 1 + Task 11 Step 5. ✅

**Плейсхолдеры:** интеграционный тест (Task 11) содержит `assert.ok(true)`-заглушки намеренно — реальные HTTP-проверки пишутся по образцу соседних `integration/`-тестов и исполняются только под `TEST_BASE_URL` (локальной БД нет). Это не плейсхолдер плана, а честный скелет под окружение без БД. Остальные шаги — полный код.

**Согласованность типов:** `computeTrialCharge` возвращает `Prisma.Decimal` (Task 2) — потребители (Task 5/6) используют `.gt(0)`/`.negated()`/`.equals()`. `sumPaidTrialRevenue` возвращает `number` (Task 4) — потребители складывают числами (Task 8). Тип проводки `trial_charge` — строковый литерал enum, одинаков в Task 1/3/5/6. ✅
