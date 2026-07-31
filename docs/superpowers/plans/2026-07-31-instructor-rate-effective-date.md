# Ставка педагога с датой вступления — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать владельцу/управляющему задавать личную ставку ЗП инструктора «с даты» — занятия считаются по ставке, действовавшей на дату занятия, и до, и после смены.

**Architecture:** Базовая `SalaryRate` = ставка «с начала» (правка мгновенна). Будущие/прошлые изменения — строки `SalaryRateSchedule` (снимок ставочного блока + `effectiveFrom`), привязанные к базовой ставке через `salaryRateId`. Чистый резолвер `pickRateAt(base, schedules, atDate)` выбирает версию по дате занятия; `resolveRate`/`resolveTrialPayMode` получают `atDate = Lesson.date`. Крон-промоутер не нужен — резолв по дате закрывает и прошлое, и будущее (в отличие от цены направления #88).

**Tech Stack:** Next.js (App Router), Prisma + PostgreSQL, TypeScript, zod, shadcn/ui, тесты — `node:test` + `node:assert` через `tsx`.

**Spec:** `docs/superpowers/specs/2026-07-31-instructor-rate-effective-date-design.md`

**Все команды выполняются из каталога `app/`.**

---

## Карта файлов

**Создать:**
- `app/src/lib/salary/pick-rate-at.ts` — чистый выбор версии ставки по дате.
- `app/src/__tests__/pick-rate-at.test.ts` — unit-тесты резолвера.
- `app/src/app/api/salary-rates/[id]/schedule/route.ts` — GET (список) / POST (создать версию).
- `app/src/app/api/salary-rates/[id]/schedule/[scheduleId]/route.ts` — PATCH / DELETE версии.
- `app/src/app/api/salary-rates/[id]/schedule/impact/route.ts` — счётчик будущих занятий.
- `app/src/components/salary/rate-schedule-section.tsx` — UI-секция «Запланированные изменения ставки».

**Изменить:**
- `app/prisma/schema.prisma` — модель `SalaryRateSchedule`, FK в `SalaryBracket`, back-relation в `SalaryRate`.
- `app/src/lib/salary/rate-schema.ts` — `scheduleCreateSchema` (валидация `effectiveFrom` в будущем).
- `app/src/__tests__/rate-schema.test.ts` — тесты `scheduleCreateSchema`.
- `app/src/lib/salary/resolve-rate.ts` — `resolveRate`/`resolveTrialPayMode` принимают `atDate`, читают версии.
- `app/src/app/api/lessons/[id]/attendance/route.ts` — 4 точки вызова (передать `lesson.date`).
- `app/src/lib/salary/reallocate-lesson-pay.ts` — передать `lesson.date`.
- `app/src/lib/services/trial-lesson.ts` — передать `date` в `resolveTrialPayMode`.
- `app/src/app/api/trial-lessons/[id]/route.ts` — `computeTrialPay` получает `atDate`.
- `app/src/lib/salary/forecast-month.ts` — резолв по дате занятия.
- `app/src/app/(dashboard)/staff/salary-rates-dialog.tsx` — рендер секции версий в `RateBlock`.
- `app/src/lib/page-help-content.ts` — справка `staff`.

---

## Task 1: Prisma-модель `SalaryRateSchedule` + FK в `SalaryBracket` + миграция

**Files:**
- Modify: `app/prisma/schema.prisma` (SalaryRate ~709-732, SalaryBracket ~758-773)

- [ ] **Step 1: Добавить back-relation в `SalaryRate`**

В модель `SalaryRate` (после строки `brackets  SalaryBracket[]`) добавить:

```prisma
  schedules SalaryRateSchedule[]
```

- [ ] **Step 2: Добавить 3-й FK в `SalaryBracket`**

В модель `SalaryBracket` добавить поле и relation (рядом с `groupSalaryRateId`):

```prisma
  salaryRateScheduleId String?  @map("salary_rate_schedule_id") @db.Uuid
```

и в блок relations (рядом с `groupSalaryRate`):

```prisma
  salaryRateSchedule SalaryRateSchedule? @relation(fields: [salaryRateScheduleId], references: [id], onDelete: Cascade)
```

и индекс (рядом с существующими `@@index`):

```prisma
  @@index([tenantId, salaryRateScheduleId])
```

- [ ] **Step 3: Добавить модель `SalaryRateSchedule`**

Сразу после модели `GroupSalaryRate` (перед `SalaryBracket`) вставить:

```prisma
// Запланированное/историческое изменение ЛИЧНОЙ ставки инструктора (ставка педагога
// «с даты»). Одна строка — полный снимок ставочного блока, действующий с
// effectiveFrom. Привязана к базовой SalaryRate (salaryRateId); резолв по дате
// занятия — lib/salary/pick-rate-at.ts. Промоутера нет: базовая SalaryRate =
// ставка «с начала», версии накладываются по дате. Групповая ставка версий не имеет.
model SalaryRateSchedule {
  id                String       @id @default(uuid()) @db.Uuid
  tenantId          String       @map("tenant_id") @db.Uuid
  salaryRateId      String       @map("salary_rate_id") @db.Uuid
  effectiveFrom     DateTime     @map("effective_from") @db.Date
  scheme            SalaryScheme
  ratePerStudent    Decimal?     @map("rate_per_student") @db.Decimal(12, 2)
  ratePerLesson     Decimal?     @map("rate_per_lesson") @db.Decimal(12, 2)
  fixedPerShift     Decimal?     @map("fixed_per_shift") @db.Decimal(12, 2)
  percentOfPayments Decimal?     @map("percent_of_payments") @db.Decimal(5, 2)
  trialPayMode      String       @default("none") @map("trial_pay_mode")
  createdAt         DateTime     @default(now()) @map("created_at")
  createdBy         String?      @map("created_by") @db.Uuid
  deletedAt         DateTime?    @map("deleted_at")

  salaryRate SalaryRate      @relation(fields: [salaryRateId], references: [id], onDelete: Cascade)
  brackets   SalaryBracket[]

  @@index([tenantId, salaryRateId, effectiveFrom])
  @@map("salary_rate_schedules")
}
```

- [ ] **Step 4: Создать и применить миграцию**

Run: `npx prisma migrate dev --name add_salary_rate_schedule`
Expected: создаётся `prisma/migrations/<timestamp>_add_salary_rate_schedule/migration.sql`, применяется к локальной БД, `prisma generate` выполняется автоматически.

Если локальная БД недоступна (нет RAM/Postgres — см. CLAUDE.md): создать миграцию без применения `npx prisma migrate dev --create-only --name add_salary_rate_schedule`, затем `npx prisma generate`; применение — через `prisma migrate deploy` на деплое (аддитивная миграция безопасна).

- [ ] **Step 5: Проверить генерацию клиента**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`. Тип `db.salaryRateSchedule` и relation `salaryRate.schedules` доступны.

- [ ] **Step 6: Commit**

```bash
git add app/prisma/schema.prisma app/prisma/migrations
git commit -m "feat(salary): модель SalaryRateSchedule — ставка педагога с даты"
```

---

## Task 2: Чистый резолвер `pickRateAt` + unit-тесты (TDD)

**Files:**
- Create: `app/src/lib/salary/pick-rate-at.ts`
- Test: `app/src/__tests__/pick-rate-at.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `app/src/__tests__/pick-rate-at.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { pickRateAt } from "../lib/salary/pick-rate-at"

const base = { ratePerLesson: 700, tag: "base" }
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
const tagOf = (r: { tag: string }) => r.tag

test("нет версий → база", () => {
  assert.equal(tagOf(pickRateAt(base, [], utc(2026, 9, 1))), "base")
  assert.equal(tagOf(pickRateAt(base, null, utc(2026, 9, 1))), "base")
})

test("atDate до границы → база (старая ставка)", () => {
  const schedules = [{ effectiveFrom: utc(2026, 9, 1), tag: "v1" }]
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2026, 8, 25))), "base")
})

test("atDate на границе (inclusive) → версия", () => {
  const schedules = [{ effectiveFrom: utc(2026, 9, 1), tag: "v1" }]
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2026, 9, 1))), "v1")
})

test("atDate после границы → версия", () => {
  const schedules = [{ effectiveFrom: utc(2026, 9, 1), tag: "v1" }]
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2026, 9, 15))), "v1")
})

test("несколько версий → ближайшая слева от atDate", () => {
  const schedules = [
    { effectiveFrom: utc(2026, 9, 1), tag: "v1" },
    { effectiveFrom: utc(2027, 1, 1), tag: "v2" },
  ]
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2026, 12, 31))), "v1")
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2027, 1, 1))), "v2")
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2026, 8, 1))), "base")
})

test("удалённая версия игнорируется", () => {
  const schedules = [{ effectiveFrom: utc(2026, 9, 1), deletedAt: utc(2026, 8, 1), tag: "v1" }]
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2026, 9, 5))), "base")
})

test("ретро-стабильность: занятие до границы всегда база, когда бы ни резолвили", () => {
  const schedules = [{ effectiveFrom: utc(2026, 9, 1), tag: "v1" }]
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2026, 8, 20))), "base")
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node --import tsx --test src/__tests__/pick-rate-at.test.ts`
Expected: FAIL — `Cannot find module '../lib/salary/pick-rate-at'`.

- [ ] **Step 3: Реализовать `pickRateAt`**

Создать `app/src/lib/salary/pick-rate-at.ts`:

```ts
import { dayNumUtc } from "@/lib/subscriptions/direction-price"

export type Dated = {
  effectiveFrom: Date | string
  deletedAt?: Date | string | null
}

/**
 * Выбирает действующую на дату версию ставки: среди неудалённых `schedules`
 * с effectiveFrom <= atDate берёт с максимальным effectiveFrom; если таких нет —
 * base. Сравнение по календарному UTC-дню (dayNumUtc из direction-price #88).
 * Чистая функция — юнит-тесты без БД (по образцу directionPriceAt).
 */
export function pickRateAt<B, S extends Dated>(
  base: B,
  schedules: S[] | null | undefined,
  atDate: Date,
): B | S {
  const at = dayNumUtc(atDate)
  let best: S | null = null
  let bestDay = -Infinity
  for (const s of schedules ?? []) {
    if (s.deletedAt != null) continue
    const day = dayNumUtc(s.effectiveFrom)
    if (day <= at && day > bestDay) {
      best = s
      bestDay = day
    }
  }
  return best ?? base
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node --import tsx --test src/__tests__/pick-rate-at.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/salary/pick-rate-at.ts app/src/__tests__/pick-rate-at.test.ts
git commit -m "feat(salary): pickRateAt — выбор версии ставки по дате занятия"
```

---

## Task 3: Валидация версии `scheduleCreateSchema` + тесты

**Files:**
- Modify: `app/src/lib/salary/rate-schema.ts`
- Test: `app/src/__tests__/rate-schema.test.ts`

- [ ] **Step 1: Добавить падающий тест**

В конец `app/src/__tests__/rate-schema.test.ts` добавить (сохранив существующие импорты; дополнить импорт `scheduleCreateSchema`):

```ts
import { scheduleCreateSchema } from "../lib/salary/rate-schema"

test("scheduleCreateSchema: дата в будущем + валидная схема → ok", () => {
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  const r = scheduleCreateSchema.safeParse({
    scheme: "per_lesson",
    ratePerLesson: 800,
    effectiveFrom: future,
  })
  assert.equal(r.success, true)
})

test("scheduleCreateSchema: прошедшая дата → ошибка", () => {
  const r = scheduleCreateSchema.safeParse({
    scheme: "per_lesson",
    ratePerLesson: 800,
    effectiveFrom: "2020-01-01",
  })
  assert.equal(r.success, false)
})

test("scheduleCreateSchema: сегодня → ошибка (строго в будущем)", () => {
  const today = new Date().toISOString().slice(0, 10)
  const r = scheduleCreateSchema.safeParse({
    scheme: "per_lesson",
    ratePerLesson: 800,
    effectiveFrom: today,
  })
  assert.equal(r.success, false)
})
```

Примечание: файл `rate-schema.test.ts` уже использует `import { test } from "node:test"` и `import assert from "node:assert/strict"` — если нет, добавить их вверху.

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --import tsx --test src/__tests__/rate-schema.test.ts`
Expected: FAIL — `scheduleCreateSchema` не экспортируется.

- [ ] **Step 3: Реализовать `scheduleCreateSchema`**

В конец `app/src/lib/salary/rate-schema.ts` добавить:

```ts
// Версия ставки «с даты»: базовый ставочный блок + effectiveFrom строго в будущем.
export const scheduleCreateSchema = baseRateSchema.extend({
  effectiveFrom: z
    .string()
    .refine((s) => !Number.isNaN(new Date(s).getTime()), { message: "Некорректная дата" })
    .refine((s) => {
      const d = new Date(s)
      const dUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
      const now = new Date()
      const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      return dUtc > todayUtc
    }, { message: "Дата вступления должна быть в будущем" }),
})

export type ScheduleCreateInput = z.infer<typeof scheduleCreateSchema>
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node --import tsx --test src/__tests__/rate-schema.test.ts`
Expected: PASS (включая новые 3 теста).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/salary/rate-schema.ts app/src/__tests__/rate-schema.test.ts
git commit -m "feat(salary): scheduleCreateSchema — валидация версии ставки (дата в будущем)"
```

---

## Task 4: `resolveRate`/`resolveTrialPayMode` по дате занятия + 4 точки вызова

Сигнатуры становятся `(db, input, atDate)`. Все 4 импортирующих файла правятся в этом же коммите — сборка остаётся зелёной.

**Files:**
- Modify: `app/src/lib/salary/resolve-rate.ts` (полная замена)
- Modify: `app/src/app/api/lessons/[id]/attendance/route.ts` (строки ~292, ~513, ~1065, ~1075)
- Modify: `app/src/lib/salary/reallocate-lesson-pay.ts` (строка ~157)
- Modify: `app/src/lib/services/trial-lesson.ts` (строка ~302)
- Modify: `app/src/app/api/trial-lessons/[id]/route.ts` (`computeTrialPay` ~28-57 + вызов)

- [ ] **Step 1: Переписать `resolve-rate.ts`**

Заменить содержимое `app/src/lib/salary/resolve-rate.ts` целиком:

```ts
import { Prisma, type PrismaClient, type SalaryScheme } from "@prisma/client"
import { pickRateAt } from "./pick-rate-at"

type DB = PrismaClient | Prisma.TransactionClient

export interface ResolvedRate {
  scheme: SalaryScheme
  ratePerStudent: Prisma.Decimal | null
  ratePerLesson: Prisma.Decimal | null
  fixedPerShift: Prisma.Decimal | null
  percentOfPayments: Prisma.Decimal | null
  brackets: { minStudents: number; ratePerLesson: Prisma.Decimal }[]
  source: "group" | "exception" | "default"
}

export interface ResolveRateInput {
  tenantId: string
  groupId: string
  employeeId: string
  directionId: string
}

// Снимок ставки (базовый SalaryRate/GroupSalaryRate или версия SalaryRateSchedule)
// → ResolvedRate. Все три носят одинаковый набор полей + brackets.
function toResolved(
  snap: {
    scheme: SalaryScheme
    ratePerStudent: Prisma.Decimal | null
    ratePerLesson: Prisma.Decimal | null
    fixedPerShift: Prisma.Decimal | null
    percentOfPayments: Prisma.Decimal | null
    brackets: { minStudents: number; ratePerLesson: Prisma.Decimal }[]
  },
  source: ResolvedRate["source"],
): ResolvedRate {
  return {
    scheme: snap.scheme,
    ratePerStudent: snap.ratePerStudent,
    ratePerLesson: snap.ratePerLesson,
    fixedPerShift: snap.fixedPerShift,
    percentOfPayments: snap.percentOfPayments,
    brackets: snap.brackets.map((b) => ({ minStudents: b.minStudents, ratePerLesson: b.ratePerLesson })),
    source,
  }
}

const withSchedules = {
  brackets: { orderBy: { minStudents: "asc" as const } },
  schedules: {
    where: { deletedAt: null },
    include: { brackets: { orderBy: { minStudents: "asc" as const } } },
  },
} as const

/**
 * Резолвит, по какой ставке считать ЗП инструктору за занятие на дату `atDate`
 * (обычно Lesson.date — ЗП считается по фактической дате занятия).
 *
 * Приоритет (по требованию владельца):
 *   1. GroupSalaryRate группы — перекрывает ВСЕ личные ставки (версий не имеет).
 *   2. SalaryRate по направлению (исключение) → её версия, действующая на atDate.
 *   3. SalaryRate дефолтная → её версия, действующая на atDate.
 *   4. null — ставка не настроена, ЗП = 0.
 *
 * Версия выбирается pickRateAt: занятие всегда считается по ставке своего периода,
 * даже если отметить/переотметить его задним числом после смены ставки.
 */
export async function resolveRate(
  db: DB,
  input: ResolveRateInput,
  atDate: Date,
): Promise<ResolvedRate | null> {
  const groupRate = await db.groupSalaryRate.findUnique({
    where: { groupId: input.groupId },
    include: { brackets: { orderBy: { minStudents: "asc" } } },
  })
  if (groupRate) return toResolved(groupRate, "group")

  const personalException = await db.salaryRate.findFirst({
    where: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      directionId: input.directionId,
    },
    include: withSchedules,
  })
  if (personalException) {
    const snap = pickRateAt(personalException, personalException.schedules, atDate)
    return toResolved(snap, "exception")
  }

  const personalDefault = await db.salaryRate.findFirst({
    where: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      directionId: null,
    },
    include: withSchedules,
  })
  if (personalDefault) {
    const snap = pickRateAt(personalDefault, personalDefault.schedules, atDate)
    return toResolved(snap, "default")
  }

  return null
}

/**
 * Режим оплаты пробного инструктору (trialPayMode) из ЛИЧНОЙ ставки на дату atDate.
 * Приоритет: ставка по направлению → дефолтная → "none". Групповую не учитываем.
 * trialPayMode входит в снимок версии — резолвим по дате так же, как ставку.
 */
export async function resolveTrialPayMode(
  db: DB,
  input: { tenantId: string; employeeId: string; directionId: string | null },
  atDate: Date,
): Promise<string> {
  const trialSchedules = {
    where: { deletedAt: null },
    select: { trialPayMode: true, effectiveFrom: true, deletedAt: true },
  } as const

  if (input.directionId) {
    const exception = await db.salaryRate.findFirst({
      where: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        directionId: input.directionId,
      },
      select: { trialPayMode: true, schedules: trialSchedules },
    })
    if (exception) return pickRateAt(exception, exception.schedules, atDate).trialPayMode
  }

  const personalDefault = await db.salaryRate.findFirst({
    where: { tenantId: input.tenantId, employeeId: input.employeeId, directionId: null },
    select: { trialPayMode: true, schedules: trialSchedules },
  })
  return personalDefault
    ? pickRateAt(personalDefault, personalDefault.schedules, atDate).trialPayMode
    : "none"
}
```

- [ ] **Step 2: Обновить attendance-роут (4 точки)**

В `app/src/app/api/lessons/[id]/attendance/route.ts`:

Точка ~292 (`resolveTrialPayMode`, одиночная отметка) — добавить `atDate`:

```ts
    ? await resolveTrialPayMode(db, {
        tenantId,
        employeeId: trialEffInstructorId,
        directionId: lesson.group.directionId,
      }, new Date(lesson.date))
```

Точка ~513 (`resolveRate`, одиночная):

```ts
      const rate = await resolveRate(tx, {
        tenantId,
        groupId: lesson.groupId,
        employeeId: lesson.substituteInstructorId || lesson.instructorId,
        directionId: lesson.group.directionId,
      }, new Date(lesson.date))
```

Точка ~1065 (`resolveRate`, bulk):

```ts
  const resolvedRate = await resolveRate(db, {
    tenantId,
    groupId: lesson.groupId,
    employeeId: effectiveInstructorId,
    directionId: lesson.group.directionId,
  }, new Date(lesson.date))
```

Точка ~1075 (`resolveTrialPayMode`, bulk):

```ts
    ? await resolveTrialPayMode(db, {
        tenantId,
        employeeId: effectiveInstructorId,
        directionId: lesson.group.directionId,
      }, new Date(lesson.date))
```

(Обе `lesson` — из `db.lesson.findFirst({ include: { group: { include: { direction: true } } } })`, поэтому `lesson.date` доступна.)

- [ ] **Step 3: Обновить `reallocate-lesson-pay.ts` (~157)**

```ts
  const rate = await resolveRate(tx, {
    tenantId,
    groupId: lesson.groupId,
    employeeId: effectiveInstructorId,
    directionId: lesson.group.directionId,
  }, new Date(lesson.date))
```

(`lesson.date` уже загружается в `select` этой функции.)

- [ ] **Step 4: Обновить `trial-lesson.ts` (~302)**

```ts
  const trialPayMode = trialInstructorId
    ? await resolveTrialPayMode(db, {
        tenantId,
        employeeId: trialInstructorId,
        directionId: effectiveDirectionId,
      }, date)
    : "none"
```

(`const date = new Date(input.scheduledDate)` определена выше по функции.)

- [ ] **Step 5: Обновить `computeTrialPay` в `trial-lessons/[id]/route.ts`**

Добавить `atDate` в тип аргументов и передать в `resolveRate`:

```ts
async function computeTrialPay(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string
    lessonId: string
    groupId: string
    clientId: string
    instructorId: string
    directionId: string
    instructorPayEnabled: boolean
    atDate: Date
  }
): Promise<Prisma.Decimal> {
  if (!args.instructorPayEnabled) return new Prisma.Decimal(0)

  const rate = await resolveRate(tx, {
    tenantId: args.tenantId,
    groupId: args.groupId,
    employeeId: args.instructorId,
    directionId: args.directionId,
  }, args.atDate)
  if (!rate) return new Prisma.Decimal(0)

  return calcPay(tx, {
    rate,
    lessonId: args.lessonId,
    tenantId: args.tenantId,
    currentClientId: args.clientId,
    currentChargeAmount: 0,
  })
}
```

Затем найти вызов `computeTrialPay(tx, {` (в ветке `attended` PATCH-хендлера) и добавить в объект аргументов:

```ts
      atDate: trial.scheduledDate,
```

(`trial` получен через `db.trialLesson.findFirst({ where, include })` — все скалярные поля, включая `scheduledDate`, доступны.)

- [ ] **Step 6: Проверить типы**

Run: `npx tsc --noEmit`
Expected: без ошибок. (Если локально не хватает RAM — положиться на CI, но проверить результат: `gh run list --repo denshimansky/crmka --limit 1`.)

- [ ] **Step 7: Прогнать все unit-тесты**

Run: `npm run test:unit`
Expected: PASS (включая `pick-rate-at`, `rate-schema`, `reallocate-lesson-pay`).

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/salary/resolve-rate.ts app/src/app/api/lessons app/src/lib/salary/reallocate-lesson-pay.ts app/src/lib/services/trial-lesson.ts app/src/app/api/trial-lessons
git commit -m "feat(salary): resolveRate по дате занятия — версии ставки в 4 точках расчёта"
```

---

## Task 5: `forecast-month.ts` — резолв ставки по дате занятия

Прогноз ЗП должен учитывать запланированную ставку для будущих занятий. Локальный `resolveRate` (не импортируемый) резолвит по `l.date`.

**Files:**
- Modify: `app/src/lib/salary/forecast-month.ts`

- [ ] **Step 1: Импортировать `pickRateAt`**

Вверху файла добавить:

```ts
import { pickRateAt } from "./pick-rate-at"
```

- [ ] **Step 2: Догрузить версии личных ставок**

В `Promise.all([...])` (загрузка `personalRates`) заменить запрос `db.salaryRate.findMany` на вариант с версиями:

```ts
    db.salaryRate.findMany({
      where: { tenantId, employeeId: { in: instructorIds } },
      include: {
        brackets: { orderBy: { minStudents: "asc" } },
        schedules: {
          where: { deletedAt: null },
          include: { brackets: { orderBy: { minStudents: "asc" } } },
        },
      },
    }),
```

- [ ] **Step 3: Резолвить версию по дате в inline-`resolveRate`**

Заменить локальную функцию `resolveRate` и её использование. Функция теперь принимает дату и накладывает версию:

```ts
  function resolveRate(
    groupId: string,
    employeeId: string,
    directionId: string,
    atDate: Date,
  ): RateLike | null {
    const group = groupRateMap.get(groupId)
    if (group) return group
    const exc = personalByDir.get(`${employeeId}:${directionId}`)
    if (exc) return pickRateAt(exc, exc.schedules, atDate) as RateLike
    const def = personalDefault.get(employeeId)
    if (def) return pickRateAt(def, def.schedules, atDate) as RateLike
    return null
  }
```

Обновить тип map'ов: `personalByDir`/`personalDefault` теперь хранят объект с `schedules`. Заменить объявления:

```ts
  const personalByDir = new Map<string, RateLike & { schedules: (RateLike & { effectiveFrom: Date; deletedAt: Date | null })[] }>()
  const personalDefault = new Map<string, RateLike & { schedules: (RateLike & { effectiveFrom: Date; deletedAt: Date | null })[] }>()
```

и цикл заполнения оставить как есть (`personalByDir.set(..., r as ...)`), приведя `r` к нужному типу через `as`.

В месте вызова (внутри `for (const l of lessons)`):

```ts
    const rate = resolveRate(l.groupId, effId, l.group.directionId, new Date(l.date))
```

Убедиться, что `l.date` есть в `select` запроса `lessons` — добавить `date: true` в `select`, если отсутствует:

```ts
    select: {
      date: true,
      groupId: true,
      instructorId: true,
      substituteInstructorId: true,
      instructor: { select: { id: true, firstName: true, lastName: true } },
      substituteInstructor: { select: { id: true, firstName: true, lastName: true } },
      group: {
        select: { directionId: true, direction: { select: { name: true } } },
      },
    },
```

- [ ] **Step 4: Проверить типы**

Run: `npx tsc --noEmit`
Expected: без ошибок. (`RateLike` уже включает `brackets`; `schedules` — расширение с `effectiveFrom`/`deletedAt`, которых достаточно для `pickRateAt`.)

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/salary/forecast-month.ts
git commit -m "feat(salary): прогноз ЗП учитывает запланированную ставку по дате занятия"
```

---

## Task 6: API `GET/POST /api/salary-rates/[id]/schedule`

**Files:**
- Create: `app/src/app/api/salary-rates/[id]/schedule/route.ts`

- [ ] **Step 1: Создать роут**

```ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { scheduleCreateSchema, validateForScheme } from "@/lib/salary/rate-schema"

// GET /api/salary-rates/[id]/schedule — версии ставки [id] (не удалённые, по дате)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = session.user.tenantId

  const rate = await db.salaryRate.findFirst({ where: { id, tenantId }, select: { id: true } })
  if (!rate) return NextResponse.json({ error: "Ставка не найдена" }, { status: 404 })

  const schedules = await db.salaryRateSchedule.findMany({
    where: { salaryRateId: id, tenantId, deletedAt: null },
    include: { brackets: { orderBy: { minStudents: "asc" } } },
    orderBy: { effectiveFrom: "asc" },
  })
  return NextResponse.json(schedules)
}

// POST /api/salary-rates/[id]/schedule — запланировать изменение ставки с даты
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = session.user.tenantId

  const rate = await db.salaryRate.findFirst({ where: { id, tenantId }, select: { id: true } })
  if (!rate) return NextResponse.json({ error: "Ставка не найдена" }, { status: 404 })

  const body = await req.json()
  const parsed = scheduleCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const validationError = validateForScheme(parsed.data)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const createdBy = (session.user as { employeeId?: string | null }).employeeId ?? null

  const created = await db.salaryRateSchedule.create({
    data: {
      tenantId,
      salaryRateId: id,
      effectiveFrom: new Date(parsed.data.effectiveFrom),
      scheme: parsed.data.scheme,
      ratePerStudent: parsed.data.ratePerStudent ?? null,
      ratePerLesson: parsed.data.ratePerLesson ?? null,
      fixedPerShift: parsed.data.fixedPerShift ?? null,
      percentOfPayments: parsed.data.percentOfPayments ?? null,
      trialPayMode: parsed.data.trialPayMode ?? "none",
      createdBy,
      brackets: parsed.data.brackets
        ? {
            create: parsed.data.brackets.map((b) => ({
              tenantId,
              minStudents: b.minStudents,
              ratePerLesson: b.ratePerLesson,
            })),
          }
        : undefined,
    },
    include: { brackets: { orderBy: { minStudents: "asc" } } },
  })

  return NextResponse.json(created, { status: 201 })
}
```

- [ ] **Step 2: Проверить типы**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/salary-rates/[id]/schedule/route.ts
git commit -m "feat(salary): API GET/POST версий ставки инструктора"
```

---

## Task 7: API `PATCH/DELETE /api/salary-rates/[id]/schedule/[scheduleId]`

**Files:**
- Create: `app/src/app/api/salary-rates/[id]/schedule/[scheduleId]/route.ts`

- [ ] **Step 1: Создать роут**

```ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { baseRateSchema, validateForScheme } from "@/lib/salary/rate-schema"

// Правка версии: тот же ставочный блок + опциональная смена effectiveFrom.
const patchSchema = baseRateSchema.extend({
  effectiveFrom: z.string().optional(),
})

// PATCH /api/salary-rates/[id]/schedule/[scheduleId]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; scheduleId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id, scheduleId } = await params
  const tenantId = session.user.tenantId

  const existing = await db.salaryRateSchedule.findFirst({
    where: { id: scheduleId, salaryRateId: id, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: "Изменение не найдено" }, { status: 404 })

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const validationError = validateForScheme(parsed.data)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const updated = await db.$transaction(async (tx) => {
    await tx.salaryRateSchedule.update({
      where: { id: scheduleId },
      data: {
        scheme: parsed.data.scheme,
        ratePerStudent: parsed.data.ratePerStudent ?? null,
        ratePerLesson: parsed.data.ratePerLesson ?? null,
        fixedPerShift: parsed.data.fixedPerShift ?? null,
        percentOfPayments: parsed.data.percentOfPayments ?? null,
        trialPayMode: parsed.data.trialPayMode ?? undefined,
        ...(parsed.data.effectiveFrom ? { effectiveFrom: new Date(parsed.data.effectiveFrom) } : {}),
      },
    })
    if (parsed.data.brackets !== undefined) {
      await tx.salaryBracket.deleteMany({ where: { salaryRateScheduleId: scheduleId } })
      if (parsed.data.brackets.length > 0) {
        await tx.salaryBracket.createMany({
          data: parsed.data.brackets.map((b) => ({
            tenantId,
            salaryRateScheduleId: scheduleId,
            minStudents: b.minStudents,
            ratePerLesson: b.ratePerLesson,
          })),
        })
      }
    }
    return tx.salaryRateSchedule.findUnique({
      where: { id: scheduleId },
      include: { brackets: { orderBy: { minStudents: "asc" } } },
    })
  })

  return NextResponse.json(updated)
}

// DELETE /api/salary-rates/[id]/schedule/[scheduleId] — soft delete
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; scheduleId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id, scheduleId } = await params
  const tenantId = session.user.tenantId

  const existing = await db.salaryRateSchedule.findFirst({
    where: { id: scheduleId, salaryRateId: id, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: "Изменение не найдено" }, { status: 404 })

  await db.salaryRateSchedule.update({ where: { id: scheduleId }, data: { deletedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Проверить типы**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/api/salary-rates/[id]/schedule/[scheduleId]/route.ts"
git commit -m "feat(salary): API PATCH/DELETE версии ставки инструктора"
```

---

## Task 8: API `GET /api/salary-rates/[id]/schedule/impact`

**Files:**
- Create: `app/src/app/api/salary-rates/[id]/schedule/impact/route.ts`

- [ ] **Step 1: Создать роут**

```ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// GET /api/salary-rates/[id]/schedule/impact?from=YYYY-MM-DD
// Счётчик будущих занятий инструктора (по этой ставке), которые пересчитаются.
// Приблизительный: не учитывает перекрытие GroupSalaryRate группы.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = session.user.tenantId

  const from = new URL(req.url).searchParams.get("from")
  if (!from) return NextResponse.json({ error: "Параметр from обязателен" }, { status: 400 })
  const fromDate = new Date(from)
  if (Number.isNaN(fromDate.getTime())) {
    return NextResponse.json({ error: "Некорректная дата" }, { status: 400 })
  }

  const rate = await db.salaryRate.findFirst({
    where: { id, tenantId },
    select: { employeeId: true, directionId: true },
  })
  if (!rate) return NextResponse.json({ error: "Ставка не найдена" }, { status: 404 })

  const count = await db.lesson.count({
    where: {
      tenantId,
      date: { gte: fromDate },
      status: { in: ["scheduled", "completed"] },
      isTrial: false,
      OR: [{ instructorId: rate.employeeId }, { substituteInstructorId: rate.employeeId }],
      ...(rate.directionId ? { group: { directionId: rate.directionId } } : {}),
    },
  })

  return NextResponse.json({ count })
}
```

- [ ] **Step 2: Проверить типы**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/salary-rates/[id]/schedule/impact/route.ts
git commit -m "feat(salary): API impact — счётчик будущих занятий для версии ставки"
```

---

## Task 9: UI — секция «Запланированные изменения ставки»

**Files:**
- Create: `app/src/components/salary/rate-schedule-section.tsx`
- Modify: `app/src/app/(dashboard)/staff/salary-rates-dialog.tsx`

- [ ] **Step 1: Создать компонент секции**

Создать `app/src/components/salary/rate-schedule-section.tsx`:

```tsx
"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Pencil, Plus, Trash2, CalendarClock } from "lucide-react"
import { useCurrencySymbol } from "@/components/currency-provider"
import {
  SalaryRateForm,
  SCHEME_LABELS,
  type RateFormValue,
  type SchemeKey,
  type TrialPayMode,
} from "@/components/salary/salary-rate-form"

interface ScheduleRow {
  id: string
  effectiveFrom: string
  scheme: SchemeKey
  ratePerStudent: string | null
  ratePerLesson: string | null
  fixedPerShift: string | null
  percentOfPayments: string | null
  trialPayMode: string | null
  brackets: { minStudents: number; ratePerLesson: string }[]
}

function rowToForm(r: ScheduleRow): RateFormValue {
  return {
    scheme: r.scheme,
    ratePerStudent: r.ratePerStudent ? Number(r.ratePerStudent) : null,
    ratePerLesson: r.ratePerLesson ? Number(r.ratePerLesson) : null,
    fixedPerShift: r.fixedPerShift ? Number(r.fixedPerShift) : null,
    percentOfPayments: r.percentOfPayments ? Number(r.percentOfPayments) : null,
    trialPayMode: (r.trialPayMode as TrialPayMode) || "none",
    brackets: r.brackets.map((b) => ({ minStudents: b.minStudents, ratePerLesson: Number(b.ratePerLesson) })),
  }
}

function summary(f: RateFormValue, sym: string): string {
  const p: string[] = [SCHEME_LABELS[f.scheme]]
  if (f.ratePerStudent) p.push(`${f.ratePerStudent}${sym}/уч.`)
  if (f.ratePerLesson) p.push(`${f.ratePerLesson}${sym}/зан.`)
  if (f.fixedPerShift) p.push(`+${f.fixedPerShift}${sym} фикс`)
  if (f.percentOfPayments) p.push(`${f.percentOfPayments}%`)
  if (f.brackets.length) p.push(`${f.brackets.length} строк`)
  return p.join(" · ")
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`
}

interface Props {
  rateId: string
  currentValue: RateFormValue
}

export function RateScheduleSection({ rateId, currentValue }: Props) {
  const sym = useCurrencySymbol()
  const [rows, setRows] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<ScheduleRow | "new" | null>(null)
  const [date, setDate] = useState("")
  const [form, setForm] = useState<RateFormValue>(currentValue)
  const [impact, setImpact] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/salary-rates/${rateId}/schedule`)
      if (res.ok) setRows(await res.json())
    } finally {
      setLoading(false)
    }
  }, [rateId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!date) {
      setImpact(null)
      return
    }
    let alive = true
    fetch(`/api/salary-rates/${rateId}/schedule/impact?from=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setImpact(d.count)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [date, rateId])

  function openNew() {
    setEditing("new")
    setDate("")
    setForm(currentValue)
    setImpact(null)
    setError(null)
  }
  function openEdit(r: ScheduleRow) {
    setEditing(r)
    setDate(r.effectiveFrom.slice(0, 10))
    setForm(rowToForm(r))
    setError(null)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        effectiveFrom: date,
        scheme: form.scheme,
        ratePerStudent: form.ratePerStudent,
        ratePerLesson: form.ratePerLesson,
        fixedPerShift: form.fixedPerShift,
        percentOfPayments: form.percentOfPayments,
        trialPayMode: form.trialPayMode,
        brackets: form.brackets,
      }
      const isEdit = editing !== "new" && editing !== null
      const url = isEdit
        ? `/api/salary-rates/${rateId}/schedule/${(editing as ScheduleRow).id}`
        : `/api/salary-rates/${rateId}/schedule`
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Не удалось сохранить")
        return
      }
      setEditing(null)
      load()
    } finally {
      setSaving(false)
    }
  }

  async function remove(r: ScheduleRow) {
    if (!confirm(`Удалить запланированное изменение с ${fmtDate(r.effectiveFrom)}?`)) return
    const res = await fetch(`/api/salary-rates/${rateId}/schedule/${r.id}`, { method: "DELETE" })
    if (res.ok) load()
  }

  // Действующая сейчас версия (прошедшая) — база может быть не равна текущей ставке.
  const now = new Date()
  const activeNow = rows
    .filter((r) => new Date(r.effectiveFrom) <= now)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0]

  return (
    <div className="mt-2 border-t pt-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <CalendarClock className="size-3.5" /> Запланированные изменения ставки
        </div>
        {!editing && (
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={openNew}>
            <Plus className="mr-1 size-3" /> С даты
          </Button>
        )}
      </div>

      {activeNow && !editing && (
        <div className="mt-1 text-xs text-muted-foreground">
          Сейчас действует: {summary(rowToForm(activeNow), sym)} (с {fmtDate(activeNow.effectiveFrom)})
        </div>
      )}

      {editing ? (
        <div className="mt-2 space-y-3 rounded-md bg-muted/30 p-3">
          {error && <div className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
          <div className="space-y-1.5">
            <Label className="text-xs">Действует с даты</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8" />
          </div>
          <SalaryRateForm value={form} onChange={setForm} />
          <div className="rounded bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Уже проведённые занятия пересчитываются по ставке своего периода.
            {date && impact !== null && ` С ${fmtDate(date)} новая ставка затронет ≈ ${impact} будущих занятий инструктора.`}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>
              Отмена
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={saving || !date}>
              {saving ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      ) : loading ? (
        <div className="mt-1 text-xs text-muted-foreground">Загрузка…</div>
      ) : rows.length === 0 ? (
        <div className="mt-1 text-xs text-muted-foreground">Нет запланированных изменений.</div>
      ) : (
        <div className="mt-1 space-y-1">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
              <span>
                <span className="font-medium">с {fmtDate(r.effectiveFrom)}</span>
                {" — "}
                <span className="text-muted-foreground">{summary(rowToForm(r), sym)}</span>
              </span>
              <span className="flex items-center gap-0.5">
                <Button type="button" variant="ghost" size="icon" className="size-6" onClick={() => openEdit(r)}>
                  <Pencil className="size-3 text-muted-foreground" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-6" onClick={() => remove(r)}>
                  <Trash2 className="size-3 text-muted-foreground" />
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Подключить секцию в `RateBlock`**

В `app/src/app/(dashboard)/staff/salary-rates-dialog.tsx`:

Добавить импорт вверху (рядом с импортом `SalaryRateForm`):

```ts
import { RateScheduleSection } from "@/components/salary/rate-schedule-section"
```

В функции `RateBlock`, внутри внешнего `<div className="rounded-md border p-3">`, после закрывающего тега блока `<div className="flex items-start justify-between gap-2">…</div>` добавить (используя уже имеющуюся в файле `rowToForm`):

```tsx
      {rate && <RateScheduleSection rateId={rate.id} currentValue={rowToForm(rate)} />}
```

- [ ] **Step 3: Проверить типы**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 4: Проверить в приложении (ручная проверка)**

Запустить dev-сервер (`npm run dev`), открыть «Сотрудники» → кошелёк инструктора → «Ставки ЗП». Под ставкой по умолчанию видна секция «Запланированные изменения ставки». «С даты» → выбрать будущую дату, поменять ставку → появляется баннер с impact → «Сохранить» → строка в списке.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/salary/rate-schedule-section.tsx "app/src/app/(dashboard)/staff/salary-rates-dialog.tsx"
git commit -m "feat(salary): UI планирования изменения ставки инструктора с даты"
```

---

## Task 10: Справка PageHelp

**Files:**
- Modify: `app/src/lib/page-help-content.ts` (pageKey `staff`, строка ~1173)

- [ ] **Step 1: Добавить пункт в справку `staff`**

В `app/src/lib/page-help-content.ts`, в блоке `staff:` (начинается на строке ~1159), в том `items`-массиве, где на строке ~1173 описан диалог «Ставки ЗП», сразу после пункта про «ставка по умолчанию + исключения по направлениям» добавить:

```ts
          "Смена ставки с даты — под каждой личной ставкой есть «Запланированные изменения ставки»: кнопка «С даты» задаёт новую ставку с будущего числа. Занятие всегда считается по ставке, действовавшей на дату занятия (в т.ч. при отметке задним числом); уже проведённые занятия пересчитываются по ставке своего периода. Ставка группы так не версионируется — меняется сразу. Доступно владельцу и управляющему",
```

- [ ] **Step 2: Проверить типы**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/page-help-content.ts
git commit -m "docs(help): справка о смене ставки инструктора с даты"
```

---

## Task 11: Финальная проверка

**Files:** —

- [ ] **Step 1: Все unit-тесты**

Run: `npm run test:unit`
Expected: PASS (в т.ч. `pick-rate-at`, `rate-schema`, `reallocate-lesson-pay`, `direction-price`).

- [ ] **Step 2: Типы всего проекта**

Run: `npx tsc --noEmit`
Expected: без ошибок. (При нехватке RAM — CI: `gh run list --repo denshimansky/crmka --limit 1`, дождаться зелёного.)

- [ ] **Step 3: Ручная проверка расчёта ЗП по дате (сценарий)**

На dev-сервере после деплоя миграции:
1. Инструктору задать ставку `per_lesson` = 700.
2. «С даты» = 1-е число следующего месяца, ставка 800, сохранить.
3. Отметить занятие текущего месяца → ЗП 700.
4. Отметить занятие следующего месяца (или перенести дату) → ЗП 800.
5. Вернуться к занятию текущего месяца, переотметить → по-прежнему 700 (ретро-стабильность).
6. «Финансы → Зарплата → Прогноз» на следующий месяц → ставка 800.

- [ ] **Step 4: Проверить CI после push (правило проекта)**

После `git push` в main: `gh run list --repo denshimansky/crmka --limit 1`. Если CI упал — починить до следующей фичи (CLAUDE.md).

---

## Self-Review (выполнено при написании плана)

**Покрытие спека:**
- Модель `SalaryRateSchedule` + FK брекетов → Task 1. ✓
- `pickRateAt` + тесты → Task 2. ✓
- `resolveRate`/`resolveTrialPayMode` по дате + 4 точки → Task 4. ✓
- `forecast-month` date-aware → Task 5. ✓
- API list/create/patch/delete/impact → Tasks 6-8. ✓
- UI секция + баннер + «сейчас действует» → Task 9. ✓
- PageHelp → Task 10. ✓
- Тесты (pickRateAt, scheduleCreateSchema) → Tasks 2-3; ретро-стабильность в тесте pickRateAt. ✓
- Вне scope (GroupSalaryRate версии, percent прогноз) — не трогаем. ✓

**Консистентность типов:** `pickRateAt(base, schedules, atDate)`, relation `SalaryRate.schedules`, FK `salaryRateScheduleId`, `scheduleCreateSchema`, `computeTrialPay(..., atDate)` — имена совпадают во всех задачах.

**Зелёная сборка по коммитам:** T1 аддитивна; T2/T3 автономны; T4 меняет сигнатуру и все 4 импортёра в одном коммите; далее только добавления. ✓
