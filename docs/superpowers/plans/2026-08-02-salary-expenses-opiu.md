# Зарплаты → расходы, вкладки Сдельная/Оклады, признание оклада в ОПИУ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Оклад окладника при проведении выплаты становится настоящим расходом (`Expense`), признаётся в ОПИУ через блок «Как провести в ОПИУ»; страница «Зарплата» получает вкладки «Сдельная»/«Оклады»; появляется редактор проведённых выплат; двойной счёт ЗП в P&L устраняется.

**Architecture:** «Твин» — оклад-выплата создаёт `SalaryPayment` (ДДС/касса/ведомость, как сейчас) + связанный `Expense` с `accountId=NULL` (только ОПИУ, как «списание товара»; ДДС такие расходы уже игнорирует). Фантомное авто-начисление оклада убирается из P&L-роута. Сдельная не меняется (accrual по занятиям).

**Tech Stack:** Next.js (App Router, server components), Prisma + PostgreSQL (raw-SQL миграции), TypeScript, shadcn/ui + Tailwind, node:test (unit), Playwright (e2e).

**Спека:** `docs/superpowers/specs/2026-08-02-salary-expenses-opiu-design.md` (решения Р1–Р8).

**Ветка:** `feature/salary-expenses-opiu` (уже создана; здесь лежит спека).

---

## Ключевые факты об окружении (прочитать перед стартом)

- **Миграции — рукописный SQL**: каждая папка `app/prisma/migrations/YYYYMMDDHHMMSS_name/migration.sql` — комментарий + DDL. НЕ `prisma migrate dev` (он сгенерирует авто-diff). Создаём папку и `migration.sql` руками, затем `npx prisma generate` для клиента.
- **Системные категории расходов** — `ExpenseCategory.tenantId = NULL` (общие для всех тенантов), `isSystem=true`. Сид в ДВУХ канонических местах: `app/prisma/seed-expense-categories.ts` и `app/prisma/seed-expense-categories.sql` (плюс упоминания в `seed.ts` / `reset-db`).
- **Unit-тесты** — `node:test` (`import { describe, it } from "node:test"`, `import assert from "node:assert/strict"`), запуск одного файла: `cd app && node --import tsx --test src/__tests__/<file>.test.ts`. Чистые функции из `@/lib`, без БД. Новый файл в `src/__tests__/**/*.test.ts` подхватывается автоматически.
- **HTTP/e2e-тесты** ходят на живой сервер (`TEST_BASE_URL` или `https://dev.umnayacrm.ru`) и `t.skip()` без сида — для проверки БД-логики они не самодостаточны. Поэтому новую бизнес-логику выносим в чистые функции и покрываем `node:test`; UI/поток проверяем typecheck + e2e.
- **Типпроверка**: `cd app && npx tsc --noEmit` (может не хватать RAM локально → полагаться на CI, но всегда проверять результат — см. CLAUDE.md §CI/CD).
- **Соглашение справки** (CLAUDE.md §Справка): при изменении страницы — обновить `page-help-content.ts`.

## Карта файлов (что и зачем)

**Создаём:**
- `app/prisma/migrations/20260802120000_oklad_expense_twin/migration.sql` — FK `expenses.salary_payment_id` + индекс + идемпотентный сид категории «Зарплата окладников».
- `app/src/lib/expense-recognition.ts` — тип `RecognitionMode` + чистая `resolveRecognition()` (маппинг режима → amortization-поля). Тестируемо.
- `app/src/lib/salary/oklad-twin.ts` — чистая `buildOkladTwinExpenses()` (позиции одной выплаты → twin-Expense по направлениям). Тестируемо.
- `app/src/components/opiu-recognition-fieldset.tsx` — переиспользуемый presentational-fieldset «Как провести в ОПИУ».
- `app/src/app/api/salary-payments/[id]/route.ts` — `PATCH`/`DELETE` (правка/аннулирование выплаты).
- `app/src/components/salary/conducted-payments-list.tsx` — список проведённых выплат периода с «Изменить»/«Аннулировать».
- `app/src/__tests__/expense-recognition.test.ts`, `app/src/__tests__/oklad-twin.test.ts` — unit-тесты.

**Меняем:**
- `app/prisma/schema.prisma` — `Expense.salaryPaymentId` + обратная связь `SalaryPayment.opiuExpenses`.
- `app/prisma/seed-expense-categories.ts` / `.sql` — добавить «Зарплата окладников».
- `app/src/app/api/salary-payments/route.ts` — `kind` + recognition-поля + создание твина в транзакции (оба ветвления).
- `app/src/app/(dashboard)/salary/page.tsx` — вкладки, классификация, per-tab кнопки, список выплат.
- `app/src/app/(dashboard)/salary/pay-salary-dialog.tsx` — режим `kind`, блок ОПИУ (для окладов).
- `app/src/app/(dashboard)/salary/payments/new/page.tsx` — режим `kind`, блок ОПИУ (документ окладов).
- `app/src/app/(dashboard)/finance/expenses/add-expense-dialog.tsx` — переключить на общий fieldset (DRY).
- `app/src/app/api/reports/pnl/route.ts` — убрать `fixedSalaryAccrued` + adjustment-термы.
- `app/src/lib/salary/forecast-month.ts` — оклад+сделка (сумма) вместо override.
- `app/src/lib/page-help-content.ts`, `app/src/lib/ai-context.ts` — справка/контекст ИИ.

---

## Task 1: Модель данных — связь Expense↔SalaryPayment + категория «Зарплата окладников»

**Files:**
- Modify: `app/prisma/schema.prisma` (Expense model 1223-1260; SalaryPayment model 813-833)
- Modify: `app/prisma/seed-expense-categories.ts:5-46`
- Modify: `app/prisma/seed-expense-categories.sql:1-25`
- Create: `app/prisma/migrations/20260802120000_oklad_expense_twin/migration.sql`

- [ ] **Step 1: Добавить поле связи в модель Expense (schema.prisma)**

В модели `Expense` после строки `recurringGroupId String? @map("recurring_group_id") @db.Uuid` добавить поле, а в блок relations — связь:

```prisma
  recurringGroupId      String?                @map("recurring_group_id") @db.Uuid
  // ОПИУ-твин выплаты оклада: этот расход создан из SalaryPayment (accountId=NULL,
  // только для признания в финрезе; ДДС/касса — на самой выплате). Удаление выплаты
  // каскадит твин. NULL — обычный расход, не связан с зарплатной выплатой.
  salaryPaymentId       String?                @map("salary_payment_id") @db.Uuid
```

И в блоке relations модели Expense добавить:

```prisma
  salaryPayment  SalaryPayment?    @relation(fields: [salaryPaymentId], references: [id], onDelete: Cascade)
```

И в `@@index` секции Expense добавить:

```prisma
  @@index([salaryPaymentId])
```

- [ ] **Step 2: Добавить обратную связь в модель SalaryPayment (schema.prisma)**

В модели `SalaryPayment` в блоке relations (после `items    SalaryPaymentItem[]`) добавить:

```prisma
  opiuExpenses SalaryPaymentTwinExpense[] @relation("SalaryPaymentTwin")
```

> ВНИМАНИЕ: Prisma требует имя обратной связи совпадающим по типу. Поскольку связь названа неявно, используем ЯВНОЕ имя на обеих сторонах. Заменить строку из Step 1:
> `salaryPayment  SalaryPayment?    @relation(fields: [salaryPaymentId], references: [id], onDelete: Cascade)`
> на:
> `salaryPayment  SalaryPayment?    @relation("SalaryPaymentTwin", fields: [salaryPaymentId], references: [id], onDelete: Cascade)`
> и в SalaryPayment добавить:
> `opiuExpenses Expense[] @relation("SalaryPaymentTwin")`

Итог в SalaryPayment relations:

```prisma
  employee     Employee            @relation(fields: [employeeId], references: [id])
  account      FinancialAccount    @relation(fields: [accountId], references: [id])
  items        SalaryPaymentItem[]
  opiuExpenses Expense[]           @relation("SalaryPaymentTwin")
```

- [ ] **Step 3: Написать миграцию (рукописный SQL)**

Создать файл `app/prisma/migrations/20260802120000_oklad_expense_twin/migration.sql`:

```sql
-- Оклад как настоящий расход (твин). Выплата оклада создаёт SalaryPayment (ДДС/касса)
-- + связанный Expense с account_id=NULL (только ОПИУ). Здесь: FK expenses.salary_payment_id
-- (ON DELETE CASCADE — аннулирование выплаты убирает твин) + индекс, и идемпотентный сид
-- системной категории «Зарплата окладников» (tenant_id=NULL, is_salary, постоянный расход).

ALTER TABLE "expenses" ADD COLUMN "salary_payment_id" UUID;

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_salary_payment_id_fkey"
  FOREIGN KEY ("salary_payment_id") REFERENCES "salary_payments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "expenses_salary_payment_id_idx" ON "expenses" ("salary_payment_id");

-- Идемпотентный сид системной категории оклад-расхода.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM expense_categories WHERE name = 'Зарплата окладников' AND tenant_id IS NULL
  ) THEN
    INSERT INTO expense_categories (id, name, is_salary, is_variable, is_system, is_active, sort_order, created_at)
    VALUES (gen_random_uuid(), 'Зарплата окладников', true, false, true, true, 14, NOW());
  END IF;
END $$;
```

- [ ] **Step 4: Добавить категорию в оба сид-файла (для свежих установок)**

В `app/prisma/seed-expense-categories.ts` в массив `categories` (после строки `{ name: "Обучение персонала", ... sortOrder: 13 },`) добавить:

```ts
    { name: "Зарплата окладников", isSalary: true, isVariable: false, sortOrder: 14 },
```

В `app/prisma/seed-expense-categories.sql` в список `VALUES` (после строки `'Обучение персонала', ... 13, NOW())`, заменив предшествующую `;` на `,`) добавить:

```sql
      (gen_random_uuid(), 'Зарплата окладников', true, false, true, true, 14, NOW());
```

- [ ] **Step 5: Применить миграцию локально и сгенерировать клиент**

Run:
```bash
cd app && npx prisma migrate deploy && npx prisma generate
```
Expected: миграция `20260802120000_oklad_expense_twin` применена; `PrismaClient` перегенерирован без ошибок. (Если локальной БД нет — минимум `npx prisma generate` после правки schema, миграция применится на CI/деплое.)

- [ ] **Step 6: Проверить, что схема валидна**

Run:
```bash
cd app && npx prisma validate
```
Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 7: Commit**

```bash
git add app/prisma/schema.prisma app/prisma/seed-expense-categories.ts app/prisma/seed-expense-categories.sql app/prisma/migrations/20260802120000_oklad_expense_twin/migration.sql
git commit -m "feat(salary): FK expenses.salary_payment_id + категория «Зарплата окладников»"
```

---

## Task 2: Чистая resolveRecognition() + RecognitionMode (TDD)

Выносим маппинг «режим признания → amortization-поля» из `add-expense-dialog.tsx:171-184` в переиспользуемую чистую функцию.

**Files:**
- Create: `app/src/lib/expense-recognition.ts`
- Create: `app/src/__tests__/expense-recognition.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `app/src/__tests__/expense-recognition.test.ts`:

```ts
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { resolveRecognition } from "@/lib/expense-recognition"

describe("resolveRecognition", () => {
  it("by_payment_date → без amortization-полей", () => {
    const r = resolveRecognition({ recognitionMode: "by_payment_date", singleMonth: "2026-07", amortStartMonth: "2026-07", amortMonths: "3" })
    assert.deepEqual(r, { recognitionMode: "by_payment_date", amortizationStartDate: undefined, amortizationMonths: undefined })
  })

  it("not_in_pnl → без amortization-полей", () => {
    const r = resolveRecognition({ recognitionMode: "not_in_pnl", singleMonth: "2026-07", amortStartMonth: "2026-07", amortMonths: "3" })
    assert.deepEqual(r, { recognitionMode: "not_in_pnl", amortizationStartDate: undefined, amortizationMonths: undefined })
  })

  it("single_period → 1 месяц, дата = 1-е число месяца признания", () => {
    const r = resolveRecognition({ recognitionMode: "single_period", singleMonth: "2026-05", amortStartMonth: "2026-07", amortMonths: "3" })
    assert.deepEqual(r, { recognitionMode: "single_period", amortizationStartDate: "2026-05-01", amortizationMonths: 1 })
  })

  it("amortized → N месяцев, дата = 1-е число стартового месяца", () => {
    const r = resolveRecognition({ recognitionMode: "amortized", singleMonth: "2026-07", amortStartMonth: "2026-09", amortMonths: "4" })
    assert.deepEqual(r, { recognitionMode: "amortized", amortizationStartDate: "2026-09-01", amortizationMonths: 4 })
  })

  it("amortized вне диапазона 2..60 → бросает ошибку с RU-сообщением", () => {
    assert.throws(
      () => resolveRecognition({ recognitionMode: "amortized", singleMonth: "2026-07", amortStartMonth: "2026-09", amortMonths: "1" }),
      /Количество месяцев должно быть от 2 до 60/,
    )
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd app && node --import tsx --test src/__tests__/expense-recognition.test.ts`
Expected: FAIL — `Cannot find module '@/lib/expense-recognition'`.

- [ ] **Step 3: Реализовать expense-recognition.ts**

Создать `app/src/lib/expense-recognition.ts`:

```ts
// Единый маппинг блока «Как провести в ОПИУ» → поля Expense (recognitionMode +
// amortization*). Используется формой расхода и формами выплаты оклада (твин).
// Дублирует то, что раньше жило инлайном в add-expense-dialog.tsx:171-184.

export type RecognitionMode = "by_payment_date" | "single_period" | "amortized" | "not_in_pnl"

export interface RecognitionInput {
  recognitionMode: RecognitionMode
  /** "YYYY-MM" — месяц признания для single_period */
  singleMonth: string
  /** "YYYY-MM" — стартовый месяц для amortized */
  amortStartMonth: string
  /** строка из <input type=number>, для amortized */
  amortMonths: string
}

export interface RecognitionPayload {
  recognitionMode: RecognitionMode
  /** "YYYY-MM-01" либо undefined */
  amortizationStartDate: string | undefined
  amortizationMonths: number | undefined
}

/** Бросает Error с RU-сообщением, если amortized-месяцы вне 2..60. */
export function resolveRecognition(input: RecognitionInput): RecognitionPayload {
  if (input.recognitionMode === "single_period") {
    return {
      recognitionMode: "single_period",
      amortizationStartDate: `${input.singleMonth}-01`,
      amortizationMonths: 1,
    }
  }
  if (input.recognitionMode === "amortized") {
    const n = Number(input.amortMonths)
    if (!Number.isFinite(n) || n < 2 || n > 60) {
      throw new Error("Количество месяцев должно быть от 2 до 60")
    }
    return {
      recognitionMode: "amortized",
      amortizationStartDate: `${input.amortStartMonth}-01`,
      amortizationMonths: n,
    }
  }
  // by_payment_date | not_in_pnl — amortization-поля не нужны.
  return { recognitionMode: input.recognitionMode, amortizationStartDate: undefined, amortizationMonths: undefined }
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `cd app && node --import tsx --test src/__tests__/expense-recognition.test.ts`
Expected: PASS (5 тестов).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/expense-recognition.ts app/src/__tests__/expense-recognition.test.ts
git commit -m "feat(finance): чистая resolveRecognition() + RecognitionMode (переиспользуемо)"
```

---

## Task 3: Чистая buildOkladTwinExpenses() (TDD)

Позиции одной оклад-выплаты (одного сотрудника) → массив твин-`Expense` по направлениям (одна строка на направление, сумма = Σ позиций этого направления).

**Files:**
- Create: `app/src/lib/salary/oklad-twin.ts`
- Create: `app/src/__tests__/oklad-twin.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `app/src/__tests__/oklad-twin.test.ts`:

```ts
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildOkladTwinExpenses } from "@/lib/salary/oklad-twin"

const baseInput = {
  tenantId: "t1",
  categoryId: "cat-oklad",
  salaryPaymentId: "sp1",
  date: new Date("2026-08-01T00:00:00.000Z"),
  recognitionMode: "single_period" as const,
  amortizationStartDate: new Date("2026-07-01T00:00:00.000Z"),
  amortizationMonths: 1,
  createdBy: "emp-owner",
}

describe("buildOkladTwinExpenses", () => {
  it("одна позиция без направления → один твин, directionId=null", () => {
    const out = buildOkladTwinExpenses({ ...baseInput, items: [{ directionId: null, amount: 40000 }] })
    assert.equal(out.length, 1)
    assert.deepEqual(out[0], {
      tenantId: "t1", categoryId: "cat-oklad", accountId: null, amount: 40000,
      date: baseInput.date, recognitionMode: "single_period",
      amortizationStartDate: baseInput.amortizationStartDate, amortizationMonths: 1,
      isVariable: false, createdBy: "emp-owner", salaryPaymentId: "sp1", directionId: null,
    })
  })

  it("позиции по нескольким направлениям → один твин на направление, суммы агрегированы", () => {
    const out = buildOkladTwinExpenses({ ...baseInput, items: [
      { directionId: "d1", amount: 10000 },
      { directionId: "d2", amount: 5000 },
      { directionId: "d1", amount: 3000 },
    ] })
    const byDir = new Map(out.map((e) => [e.directionId, e.amount]))
    assert.equal(out.length, 2)
    assert.equal(byDir.get("d1"), 13000)
    assert.equal(byDir.get("d2"), 5000)
  })

  it("пустые позиции → пустой массив", () => {
    assert.deepEqual(buildOkladTwinExpenses({ ...baseInput, items: [] }), [])
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd app && node --import tsx --test src/__tests__/oklad-twin.test.ts`
Expected: FAIL — `Cannot find module '@/lib/salary/oklad-twin'`.

- [ ] **Step 3: Реализовать oklad-twin.ts**

Создать `app/src/lib/salary/oklad-twin.ts`:

```ts
import type { ExpenseRecognitionMode } from "@prisma/client"

export interface OkladTwinItem {
  directionId: string | null
  amount: number
}

export interface BuildOkladTwinInput {
  tenantId: string
  categoryId: string
  salaryPaymentId: string
  date: Date
  recognitionMode: ExpenseRecognitionMode
  amortizationStartDate: Date | null
  amortizationMonths: number | null
  createdBy: string | null
  items: OkladTwinItem[]
}

export interface OkladTwinExpense {
  tenantId: string
  categoryId: string
  accountId: null
  amount: number
  date: Date
  recognitionMode: ExpenseRecognitionMode
  amortizationStartDate: Date | null
  amortizationMonths: number | null
  isVariable: false
  createdBy: string | null
  salaryPaymentId: string
  /** для ExpenseBranch (прямое разнесение расхода по направлению в ОПИУ) */
  directionId: string | null
}

/**
 * Позиции ОДНОЙ оклад-выплаты (одного сотрудника) → твин-расходы: одна строка
 * Expense на каждое направление (directionId), сумма = Σ позиций направления.
 * accountId=NULL → расход только для ОПИУ (ДДС даёт сама SalaryPayment).
 */
export function buildOkladTwinExpenses(input: BuildOkladTwinInput): OkladTwinExpense[] {
  const byDirection = new Map<string | null, number>()
  for (const it of input.items) {
    const key = it.directionId ?? null
    byDirection.set(key, (byDirection.get(key) ?? 0) + it.amount)
  }
  const out: OkladTwinExpense[] = []
  for (const [directionId, amount] of byDirection.entries()) {
    out.push({
      tenantId: input.tenantId,
      categoryId: input.categoryId,
      accountId: null,
      amount,
      date: input.date,
      recognitionMode: input.recognitionMode,
      amortizationStartDate: input.amortizationStartDate,
      amortizationMonths: input.amortizationMonths,
      isVariable: false,
      createdBy: input.createdBy,
      salaryPaymentId: input.salaryPaymentId,
      directionId,
    })
  }
  return out
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `cd app && node --import tsx --test src/__tests__/oklad-twin.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/salary/oklad-twin.ts app/src/__tests__/oklad-twin.test.ts
git commit -m "feat(salary): чистая buildOkladTwinExpenses() (позиции выплаты → твин-расходы)"
```

---

## Task 4: API — создание твина при проведении выплаты оклада

Расширяем `POST /api/salary-payments`: тело получает `kind` (`'salary'|'piece'`, дефолт `'piece'`) и recognition-поля; при `kind='salary'` в той же транзакции создаём твин-`Expense` (+`ExpenseBranch`) на каждую созданную выплату.

**Files:**
- Modify: `app/src/app/api/salary-payments/route.ts` (schemas 13-58; POST 96-318)

- [ ] **Step 1: Добавить импорт и константу категории**

В начало `route.ts` (рядом с существующими импортами) добавить:

```ts
import { buildOkladTwinExpenses } from "@/lib/salary/oklad-twin"

const OKLAD_EXPENSE_CATEGORY_NAME = "Зарплата окладников"

/** Возвращает id системной категории оклад-расхода, создавая её при отсутствии. */
async function getOkladCategoryId(tx: { expenseCategory: any }): Promise<string> {
  const existing = await tx.expenseCategory.findFirst({
    where: { name: OKLAD_EXPENSE_CATEGORY_NAME, tenantId: null },
    select: { id: true },
  })
  if (existing) return existing.id
  const created = await tx.expenseCategory.create({
    data: { tenantId: null, name: OKLAD_EXPENSE_CATEGORY_NAME, isSalary: true, isVariable: false, isSystem: true, isActive: true, sortOrder: 14 },
    select: { id: true },
  })
  return created.id
}
```

- [ ] **Step 2: Расширить схемы тела (kind + recognition-поля)**

В `docSchema` (route.ts:29-58) внутри `z.object({ ... })` (до `.refine(...)`) добавить поля:

```ts
  kind: z.enum(["salary", "piece"]).default("piece"),
  recognitionMode: z.enum(["by_payment_date", "single_period", "amortized", "not_in_pnl"]).default("by_payment_date"),
  amortizationStartDate: z.string().optional().nullable(),
  amortizationMonths: z.number().int().min(1).max(60).optional().nullable(),
```

В `legacySchema` (route.ts:13-25) внутри `z.object({ ... })` добавить те же четыре поля:

```ts
  kind: z.enum(["salary", "piece"]).default("piece"),
  recognitionMode: z.enum(["by_payment_date", "single_period", "amortized", "not_in_pnl"]).default("by_payment_date"),
  amortizationStartDate: z.string().optional().nullable(),
  amortizationMonths: z.number().int().min(1).max(60).optional().nullable(),
```

- [ ] **Step 3: В doc-ветке создавать твин после каждой выплаты сотрудника**

В `route.ts` внутри цикла `for (const [empId, empItems] of itemsByEmployee.entries())` (после блока `await tx.salaryPaymentItem.createMany({...})`, перед закрытием цикла) добавить создание твина. Заменить фрагмент:

```ts
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
```

на:

```ts
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

          // Оклад-выплата → твин-расход(ы) для ОПИУ (accountId=NULL, ДДС их игнорирует).
          if (data.kind === "salary") {
            const okladCategoryId = await getOkladCategoryId(tx)
            const twins = buildOkladTwinExpenses({
              tenantId,
              categoryId: okladCategoryId,
              salaryPaymentId: created.id,
              date: new Date(data.date),
              recognitionMode: data.recognitionMode,
              amortizationStartDate: data.amortizationStartDate ? new Date(data.amortizationStartDate) : null,
              amortizationMonths: data.amortizationMonths ?? null,
              createdBy: employeeId ?? null,
              items: empItems.map((it) => ({ directionId: it.directionId ?? null, amount: it.amount })),
            })
            for (const t of twins) {
              const exp = await tx.expense.create({
                data: {
                  tenantId: t.tenantId,
                  categoryId: t.categoryId,
                  accountId: null,
                  amount: t.amount,
                  date: t.date,
                  recognitionMode: t.recognitionMode,
                  amortizationStartDate: t.amortizationStartDate,
                  amortizationMonths: t.amortizationMonths,
                  isVariable: false,
                  salaryPaymentId: t.salaryPaymentId,
                  createdBy: t.createdBy,
                },
                select: { id: true },
              })
              if (t.directionId) {
                await tx.expenseBranch.create({
                  data: { tenantId, expenseId: exp.id, branchId: null, directionId: t.directionId },
                })
              }
            }
          }
        }
```

- [ ] **Step 4: В legacy-ветке создавать твин (направление = defaultDirection сотрудника)**

Простой диалог не передаёт направление; для оклада тянем `defaultDirectionId` из карточки. Заменить в legacy-ветке блок загрузки сотрудника (route.ts:254-259):

```ts
  const [employee, account] = await Promise.all([
    db.employee.findFirst({ where: { id: data.employeeId, tenantId }, select: { id: true } }),
    db.financialAccount.findFirst({ where: { id: data.accountId, tenantId }, select: { id: true } }),
  ])
  if (!employee) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
  if (!account) return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })
```

на:

```ts
  const [employee, account] = await Promise.all([
    db.employee.findFirst({ where: { id: data.employeeId, tenantId }, select: { id: true, defaultDirectionId: true } }),
    db.financialAccount.findFirst({ where: { id: data.accountId, tenantId }, select: { id: true } }),
  ])
  if (!employee) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
  if (!account) return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })
```

Затем в legacy-транзакции, после создания зеркальной `salaryPaymentItem` и перед `await tx.financialAccount.update(...)`, добавить:

```ts
    if (data.kind === "salary") {
      const okladCategoryId = await getOkladCategoryId(tx)
      const exp = await tx.expense.create({
        data: {
          tenantId,
          categoryId: okladCategoryId,
          accountId: null,
          amount: data.amount,
          date: new Date(data.date),
          recognitionMode: data.recognitionMode,
          amortizationStartDate: data.amortizationStartDate ? new Date(data.amortizationStartDate) : null,
          amortizationMonths: data.amortizationMonths ?? null,
          isVariable: false,
          salaryPaymentId: p.id,
          createdBy: employeeId ?? null,
        },
        select: { id: true },
      })
      if (employee.defaultDirectionId) {
        await tx.expenseBranch.create({
          data: { tenantId, expenseId: exp.id, branchId: null, directionId: employee.defaultDirectionId },
        })
      }
    }
```

- [ ] **Step 5: Типпроверка**

Run: `cd app && npx tsc --noEmit`
Expected: без ошибок в `salary-payments/route.ts` (учесть, что `tx` в `getOkladCategoryId` типизирован широко — при ошибке типа заменить параметр на `Prisma.TransactionClient` с импортом `import { Prisma } from "@prisma/client"`).

- [ ] **Step 6: Дымовая проверка на dev (ручная, опционально)**

Проверить POST с `kind:"salary"` через существующую форму (после Task 10/11) или curl: после проведения оклад-выплаты в БД появляется `expenses` с `account_id IS NULL`, `salary_payment_id = <id выплаты>`, категория «Зарплата окладников».

- [ ] **Step 7: Commit**

```bash
git add app/src/app/api/salary-payments/route.ts
git commit -m "feat(salary): kind=salary создаёт твин-Expense (ОПИУ) в транзакции выплаты"
```

---

## Task 5: API — редактор выплат (DELETE аннулирование + PATCH правка)

**Files:**
- Create: `app/src/app/api/salary-payments/[id]/route.ts`

- [ ] **Step 1: Реализовать DELETE (аннулирование) + PATCH (правка)**

Создать `app/src/app/api/salary-payments/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-lock"
import { logAudit } from "@/lib/audit"
import { z } from "zod"
import { buildOkladTwinExpenses } from "@/lib/salary/oklad-twin"

const OKLAD_EXPENSE_CATEGORY_NAME = "Зарплата окладников"

async function getOkladCategoryId(tx: { expenseCategory: any }): Promise<string> {
  const existing = await tx.expenseCategory.findFirst({
    where: { name: OKLAD_EXPENSE_CATEGORY_NAME, tenantId: null },
    select: { id: true },
  })
  if (existing) return existing.id
  const created = await tx.expenseCategory.create({
    data: { tenantId: null, name: OKLAD_EXPENSE_CATEGORY_NAME, isSalary: true, isVariable: false, isSystem: true, isActive: true, sortOrder: 14 },
    select: { id: true },
  })
  return created.id
}

const patchSchema = z.object({
  amount: z.number().min(0.01),
  accountId: z.string().uuid(),
  date: z.string().min(1),
  directionId: z.string().uuid().nullable().optional(),
  recognitionMode: z.enum(["by_payment_date", "single_period", "amortized", "not_in_pnl"]).default("by_payment_date"),
  amortizationStartDate: z.string().optional().nullable(),
  amortizationMonths: z.number().int().min(1).max(60).optional().nullable(),
})

function gate(session: any) {
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return { error: NextResponse.json({ error: "Редактирование выплат доступно только владельцу и управляющему" }, { status: 403 }) }
  }
  return { role }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  const g = gate(session)
  if (g.error) return g.error
  const { id } = await params
  const tenantId = session!.user.tenantId
  const actor = session!.user.employeeId

  const payment = await db.salaryPayment.findFirst({
    where: { id, tenantId },
    select: { id: true, accountId: true, amount: true, periodYear: true, periodMonth: true },
  })
  if (!payment) return NextResponse.json({ error: "Выплата не найдена" }, { status: 404 })

  if (await isPeriodLocked(tenantId, new Date(Date.UTC(payment.periodYear, payment.periodMonth - 1, 1)), g.role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  await db.$transaction(async (tx) => {
    // Вернуть деньги на счёт.
    await tx.financialAccount.update({ where: { id: payment.accountId }, data: { balance: { increment: payment.amount } } })
    // Твин-Expense удалятся каскадом по FK (expenses.salary_payment_id ON DELETE CASCADE),
    // SalaryPaymentItem — каскадом по своей связи. Явно удаляем шапку выплаты.
    await tx.salaryPayment.delete({ where: { id: payment.id } })
  })

  logAudit({
    tenantId, employeeId: actor, action: "delete", entityType: "SalaryPayment", entityId: payment.id,
    changes: { amount: { old: Number(payment.amount) } }, req,
  })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  const g = gate(session)
  if (g.error) return g.error
  const { id } = await params
  const tenantId = session!.user.tenantId
  const actor = session!.user.employeeId

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  const data = parsed.data

  const payment = await db.salaryPayment.findFirst({
    where: { id, tenantId },
    select: { id: true, accountId: true, amount: true, employeeId: true, periodYear: true, periodMonth: true, opiuExpenses: { select: { id: true } } },
  })
  if (!payment) return NextResponse.json({ error: "Выплата не найдена" }, { status: 404 })

  if (await isPeriodLocked(tenantId, new Date(Date.UTC(payment.periodYear, payment.periodMonth - 1, 1)), g.role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }
  const account = await db.financialAccount.findFirst({ where: { id: data.accountId, tenantId }, select: { id: true } })
  if (!account) return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })

  const isSalary = payment.opiuExpenses.length > 0 // была ли выплата оклад-типа (есть твин)

  await db.$transaction(async (tx) => {
    // Откат старого баланса и применение нового (счёт мог смениться).
    await tx.financialAccount.update({ where: { id: payment.accountId }, data: { balance: { increment: payment.amount } } })
    await tx.financialAccount.update({ where: { id: data.accountId }, data: { balance: { decrement: data.amount } } })

    // Обновить шапку и зеркальную позицию.
    await tx.salaryPayment.update({
      where: { id: payment.id },
      data: { accountId: data.accountId, amount: data.amount, date: new Date(data.date) },
    })
    await tx.salaryPaymentItem.deleteMany({ where: { salaryPaymentId: payment.id } })
    await tx.salaryPaymentItem.create({
      data: { tenantId, salaryPaymentId: payment.id, employeeId: payment.employeeId, accountId: data.accountId, directionId: data.directionId ?? null, amount: data.amount },
    })

    // Пересоздать твин (только если выплата оклад-типа).
    await tx.expense.deleteMany({ where: { salaryPaymentId: payment.id } })
    if (isSalary) {
      const okladCategoryId = await getOkladCategoryId(tx)
      const twins = buildOkladTwinExpenses({
        tenantId, categoryId: okladCategoryId, salaryPaymentId: payment.id, date: new Date(data.date),
        recognitionMode: data.recognitionMode,
        amortizationStartDate: data.amortizationStartDate ? new Date(data.amortizationStartDate) : null,
        amortizationMonths: data.amortizationMonths ?? null,
        createdBy: actor ?? null,
        items: [{ directionId: data.directionId ?? null, amount: data.amount }],
      })
      for (const t of twins) {
        const exp = await tx.expense.create({
          data: {
            tenantId, categoryId: t.categoryId, accountId: null, amount: t.amount, date: t.date,
            recognitionMode: t.recognitionMode, amortizationStartDate: t.amortizationStartDate, amortizationMonths: t.amortizationMonths,
            isVariable: false, salaryPaymentId: t.salaryPaymentId, createdBy: t.createdBy,
          },
          select: { id: true },
        })
        if (t.directionId) {
          await tx.expenseBranch.create({ data: { tenantId, expenseId: exp.id, branchId: null, directionId: t.directionId } })
        }
      }
    }
  })

  logAudit({
    tenantId, employeeId: actor, action: "update", entityType: "SalaryPayment", entityId: payment.id,
    changes: { amount: { old: Number(payment.amount), new: data.amount } }, req,
  })
  return NextResponse.json({ ok: true })
}
```

> ПРИМЕЧАНИЕ по импортам: свериться с фактическими путями в `route.ts` из Task 4 — `authOptions` может импортироваться из `@/lib/auth` (как в POST). `isPeriodLocked` и `logAudit` — те же модули, что уже используются в `salary-payments/route.ts` (скопировать пути импортов оттуда).
> Аннулирование НЕ трогает `SalaryAdjustment` (премии/штрафы) — они не связаны с выплатой (период-уровень), управляются отдельно (см. спека §Открытые риски).

- [ ] **Step 2: Типпроверка**

Run: `cd app && npx tsc --noEmit`
Expected: без ошибок. При несовпадении путей импортов (`authOptions`/`isPeriodLocked`/`logAudit`) — поправить по образцу `salary-payments/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/salary-payments/[id]/route.ts
git commit -m "feat(salary): редактор выплат — PATCH/DELETE (откат баланса, ресинк твина, owner/manager)"
```

---

## Task 6: P&L-роут — убрать фантомный оклад-accrual и adjustment-термы

**Files:**
- Modify: `app/src/app/api/reports/pnl/route.ts:170-218`

- [ ] **Step 1: Заменить блок начислений ЗП**

Заменить в `pnl/route.ts` фрагмент 170-218 (VERBATIM ниже) —

```ts
  // Начисленная ЗП инструкторов = факт занятий (по дате занятия), как было.
  const salaryAtt = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: dateFrom, lte: dateTo } },
      instructorPayEnabled: true,
      ...(branchId ? { lesson: { date: { gte: dateFrom, lte: dateTo }, group: { branchId } } } : {}),
    },
    select: { instructorPayAmount: true },
  })
  const instructorSalaryAccrued = salaryAtt.reduce((s, a) => s + Number(a.instructorPayAmount), 0)

  // Окладники: Employee.monthlySalary × (число месяцев в окне). Окно ОПИУ обычно = 1 месяц
  // (MonthPicker), но если кто-то задал диапазон — считаем по числу полных месяцев.
  const monthsInWindow =
    (toY - fromY) * 12 + (toM - fromM) + 1
  const salariedEmployees = await db.employee.findMany({
    where: { tenantId, deletedAt: null, isActive: true, monthlySalary: { not: null } },
    select: { id: true, monthlySalary: true },
  })
  const monthlySalaryTotal = salariedEmployees.reduce(
    (s, e) => s + Number(e.monthlySalary ?? 0),
    0,
  )
  const fixedSalaryAccrued = monthlySalaryTotal * monthsInWindow

  // Премии / штрафы окладников и преподов за окно.
  const adjustments = await db.salaryAdjustment.findMany({
    where: {
      tenantId,
      periodYear: { gte: fromY, lte: toY },
      // Дополнительной фильтрации по месяцу не делаем — для одиночного месяца fromY=toY,
      // а в P&L UI окно почти всегда = 1 месяц.
    },
    select: { type: true, amount: true, periodYear: true, periodMonth: true },
  })
  let adjustBonus = 0
  let adjustPenalty = 0
  for (const adj of adjustments) {
    const k = adj.periodYear * 12 + (adj.periodMonth - 1)
    const fromKey = fromY * 12 + (fromM - 1)
    const toKey = toY * 12 + (toM - 1)
    if (k < fromKey || k > toKey) continue
    if (adj.type === "bonus") adjustBonus += Number(adj.amount)
    else adjustPenalty += Number(adj.amount)
  }

  const totalSalaryAccrued =
    instructorSalaryAccrued + fixedSalaryAccrued + adjustBonus - adjustPenalty
```

на:

```ts
  // Начисленная ЗП инструкторов (сдельная) = факт занятий по дате занятия.
  // Оклад окладников больше НЕ начисляется здесь фантомно: он приходит настоящим
  // расходом (категория «Зарплата окладников», твин выплаты) и уже учтён в totalExpenses.
  // Премии/штрафы окладников также приходят суммой выплаты (в твине), поэтому
  // SalaryAdjustment в ОПИУ здесь не суммируется — иначе двойной счёт.
  const salaryAtt = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: dateFrom, lte: dateTo } },
      instructorPayEnabled: true,
      ...(branchId ? { lesson: { date: { gte: dateFrom, lte: dateTo }, group: { branchId } } } : {}),
    },
    select: { instructorPayAmount: true },
  })
  const totalSalaryAccrued = salaryAtt.reduce((s, a) => s + Number(a.instructorPayAmount), 0)
```

> Downstream (`totalVariableCosts`/`margin`/`netProfit`, строки 229-238) читают `totalSalaryAccrued` — их не трогаем, значение просто переопределено на «только сдельная». Оклад-расход теперь попадает в `totalExpenses` (постоянные, категория `isVariable=false`).
> Если после удаления `monthsInWindow`/`fromKey`/`toKey`/`fromY`/`toY` где-то остались неиспользуемые переменные — TS их не запретит (они, скорее всего, используются выше для расходов). Проверить tsc.

- [ ] **Step 2: Типпроверка**

Run: `cd app && npx tsc --noEmit`
Expected: без ошибок. Если `monthsInWindow` больше нигде не используется — удалить объявление (оно было только в удалённом блоке).

- [ ] **Step 3: Sanity-проверка данными (msk1, read-only)**

Через SSH к msk1 (см. память `reference_msk1_db_access`) проверить, что для тестовой орг с окладниками P&L-роут больше не двоит оклад: сравнить `netProfit` до/после на месяце, где есть оклад-твины. (Ручная проверка; фиксируется в PR-описании.)

- [ ] **Step 4: Commit**

```bash
git add app/src/app/api/reports/pnl/route.ts
git commit -m "fix(reports): P&L-роут больше не двоит оклад — снят фантом-accrual + adjustment-термы"
```

---

## Task 7: forecast-month — оклад + сделка (сумма) вместо override

**Files:**
- Modify: `app/src/lib/salary/forecast-month.ts:192-236` (+ docstrings 18-28, 59-79)

- [ ] **Step 1: Заменить цикл начисления (убрать `continue`, помечать isOklad)**

Заменить фрагмент 192-215 (VERBATIM) —

```ts
  for (const l of lessons) {
    const eff = l.substituteInstructorId ? l.substituteInstructor : l.instructor
    const effId = l.substituteInstructorId || l.instructorId
    const name = [eff?.lastName, eff?.firstName].filter(Boolean).join(" ") || effId

    // Окладник: оклад — фикс за месяц (не за занятие). Считаем занятия, но
    // forecast = оклад (проставляется один раз ниже). Оклад перекрывает сдельку.
    if (okladMap.has(effId)) {
      const a = ensure(effId, name, true)
      a.lessonsCount += 1
      if (l.group.direction?.name) a.directions.add(l.group.direction.name)
      continue
    }

    const rate = resolveRate(l.groupId, effId, l.group.directionId, new Date(l.date))
    if (!rate) continue
    const students = enrollCount.get(l.groupId) || 0
    const a = ensure(effId, name, false)
    a.forecast += lessonPay(rate, students)
    a.lessonsCount += 1
    a.studentsCount += students
    if (l.group.direction?.name) a.directions.add(l.group.direction.name)
    a.schemeCount.set(rate.scheme, (a.schemeCount.get(rate.scheme) || 0) + 1)
  }
```

на:

```ts
  for (const l of lessons) {
    const eff = l.substituteInstructorId ? l.substituteInstructor : l.instructor
    const effId = l.substituteInstructorId || l.instructorId
    const name = [eff?.lastName, eff?.firstName].filter(Boolean).join(" ") || effId

    // Оклад + сделка суммируются: у окладника считаем и оклад (фикс за месяц,
    // прибавляется в сборке строк ниже), и сдельное начисление за проведённые
    // занятия. Если ставка не резолвится — сделочная часть просто 0 (только оклад).
    const isOklad = okladMap.has(effId)
    const a = ensure(effId, name, isOklad)
    a.lessonsCount += 1
    if (l.group.direction?.name) a.directions.add(l.group.direction.name)

    const rate = resolveRate(l.groupId, effId, l.group.directionId, new Date(l.date))
    if (!rate) continue
    const students = enrollCount.get(l.groupId) || 0
    a.forecast += lessonPay(rate, students)
    a.studentsCount += students
    a.schemeCount.set(rate.scheme, (a.schemeCount.get(rate.scheme) || 0) + 1)
  }
```

- [ ] **Step 2: Заменить сборку строки forecast (оклад ПЛЮС сделка)**

В блоке сборки строк (217-236) заменить строку:

```ts
      forecast: a.isOklad ? (okladMap.get(a.instructorId) || 0) : a.forecast,
```

на:

```ts
      forecast: a.forecast + (a.isOklad ? (okladMap.get(a.instructorId) || 0) : 0),
```

- [ ] **Step 3: Обновить docstrings**

В `forecast-month.ts:22` заменить комментарий поля интерфейса:

```ts
  /** Оклад перекрывает сдельный расчёт: для окладника forecast = его оклад. */
```

на:

```ts
  /** Окладник: forecast = оклад + сдельное начисление за проведённые занятия. */
```

В docstring функции (59-79) заменить строки правила:

```ts
 *   • Окладник (Employee.monthlySalary > 0) → берём оклад как фикс за месяц,
 *     независимо от числа занятий. Оклад перекрывает сдельный расчёт.
```

на:

```ts
 *   • Окладник (Employee.monthlySalary > 0) → оклад как фикс за месяц ПЛЮС
 *     сдельное начисление за проведённые занятия (если ставка резолвится).
```

- [ ] **Step 4: Типпроверка**

Run: `cd app && npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/salary/forecast-month.ts
git commit -m "feat(salary): прогноз ЗП окладника = оклад + сделка (сумма вместо override)"
```

---

## Task 8: Вынести переиспользуемый fieldset «Как провести в ОПИУ»

**Files:**
- Create: `app/src/components/opiu-recognition-fieldset.tsx`
- Modify: `app/src/app/(dashboard)/finance/expenses/add-expense-dialog.tsx` (state 112-115, submit 171-184, fieldset 396-503)

- [ ] **Step 1: Создать компонент fieldset**

Создать `app/src/components/opiu-recognition-fieldset.tsx`:

```tsx
"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { RecognitionMode } from "@/lib/expense-recognition"

const MONTH_NAMES = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
]
function formatMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number)
  if (!y || !m || m < 1 || m > 12) return yyyymm
  return `${MONTH_NAMES[m - 1]} ${y}`
}
function shiftMonth(yyyymm: string, delta: number): string {
  const [y, m] = yyyymm.split("-").map(Number)
  if (!y || !m) return yyyymm
  const k = y * 12 + (m - 1) + delta
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`
}
function fmtNum(amount: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount)
}

export interface OpiuRecognitionState {
  recognitionMode: RecognitionMode
  singleMonth: string
  amortStartMonth: string
  amortMonths: string
}

export function OpiuRecognitionFieldset({
  value,
  onChange,
  amount,
  sym,
}: {
  value: OpiuRecognitionState
  onChange: (next: OpiuRecognitionState) => void
  amount: number
  sym: string
}) {
  const set = (patch: Partial<OpiuRecognitionState>) => onChange({ ...value, ...patch })
  const amortN = Math.max(2, Math.min(60, Number(value.amortMonths) || 0))
  const amortPerMonth = amount > 0 && amortN > 0 ? amount / amortN : 0
  const amortEndMonth = shiftMonth(value.amortStartMonth, amortN - 1)

  return (
    <fieldset className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Как провести в ОПИУ</legend>
      <p className="text-xs text-muted-foreground">
        В ДДС расход всегда учитывается по дате платежа. В ОПИУ — по периоду признания.
      </p>

      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="recognition-mode" className="mt-1"
          checked={value.recognitionMode === "by_payment_date"}
          onChange={() => set({ recognitionMode: "by_payment_date" })} />
        <span>
          <span className="font-medium">Одной суммой по дате платежа</span>
          <span className="block text-xs text-muted-foreground">ОПИУ и ДДС совпадают: расход относится к месяцу даты выше.</span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="recognition-mode" className="mt-1"
          checked={value.recognitionMode === "single_period"}
          onChange={() => set({ recognitionMode: "single_period" })} />
        <span className="flex-1">
          <span className="font-medium">Одной суммой в другом месяце</span>
          <span className="block text-xs text-muted-foreground">Например, ЗП июля выплачена 1 августа → ОПИУ июль.</span>
          {value.recognitionMode === "single_period" && (
            <div className="mt-2 space-y-1.5">
              <Label className="text-xs">Месяц признания</Label>
              <Input type="month" value={value.singleMonth} onChange={(e) => set({ singleMonth: e.target.value })} />
            </div>
          )}
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="recognition-mode" className="mt-1"
          checked={value.recognitionMode === "amortized"}
          onChange={() => set({ recognitionMode: "amortized" })} />
        <span className="flex-1">
          <span className="font-medium">Разделить на N месяцев</span>
          <span className="block text-xs text-muted-foreground">Например, годовой бонус разбить по месяцам.</span>
          {value.recognitionMode === "amortized" && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Начиная с</Label>
                <Input type="month" value={value.amortStartMonth} onChange={(e) => set({ amortStartMonth: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Месяцев</Label>
                <Input type="number" min="2" max="60" value={value.amortMonths} onChange={(e) => set({ amortMonths: e.target.value })} />
              </div>
              {amortPerMonth > 0 && (
                <p className="col-span-2 text-xs text-muted-foreground">
                  {formatMonth(value.amortStartMonth)} — {formatMonth(amortEndMonth)} (по {fmtNum(amortPerMonth)} {sym}/мес)
                </p>
              )}
            </div>
          )}
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="recognition-mode" className="mt-1"
          checked={value.recognitionMode === "not_in_pnl"}
          onChange={() => set({ recognitionMode: "not_in_pnl" })} />
        <span>
          <span className="font-medium">Не учитывать в финрезе</span>
          <span className="block text-xs text-muted-foreground">Только ДДС: расход уменьшит остаток на счёте, но не попадёт в ОПИУ.</span>
        </span>
      </label>
    </fieldset>
  )
}
```

- [ ] **Step 2: Перевести add-expense-dialog на общий fieldset (DRY)**

В `add-expense-dialog.tsx`:
1. Добавить импорты: `import { OpiuRecognitionFieldset, type OpiuRecognitionState } from "@/components/opiu-recognition-fieldset"` и `import { resolveRecognition } from "@/lib/expense-recognition"`.
2. Заменить 4 отдельных стейта (112-115) одним объектом:
```tsx
  const [opiu, setOpiu] = useState<OpiuRecognitionState>({
    recognitionMode: "by_payment_date", singleMonth: todayMonth, amortStartMonth: todayMonth, amortMonths: "3",
  })
```
3. В `reset()` (127-130) заменить 4 сброса на:
```tsx
    setOpiu({ recognitionMode: "by_payment_date", singleMonth: todayMonth, amortStartMonth: todayMonth, amortMonths: "3" })
```
4. Заменить submit-маппинг (171-184) на:
```tsx
    let recognitionPayload
    try {
      recognitionPayload = resolveRecognition(opiu)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка признания")
      return
    }
    const { recognitionMode, amortizationStartDate, amortizationMonths } = recognitionPayload
```
5. Заменить весь `<fieldset>...</fieldset>` (396-503) на:
```tsx
          <OpiuRecognitionFieldset value={opiu} onChange={setOpiu} amount={Number(amount) || 0} sym={sym} />
```
6. Удалить ставшие ненужными локальные `type RecognitionMode`, `MONTH_NAMES`, `formatMonth`, `shiftMonth`, `formatMoney`, и превью-переменные `amortN/amortPerMonth/amortEndMonth` (244-248), если они больше нигде не используются в файле. (Проверить grep’ом перед удалением; `formatMoney` может использоваться в других местах диалога — тогда оставить.)

- [ ] **Step 3: Типпроверка + прогон unit-набора**

Run: `cd app && npx tsc --noEmit && node --import tsx --test src/__tests__/expense-recognition.test.ts`
Expected: tsc без ошибок; тесты PASS.

- [ ] **Step 4: Дымовая проверка формы расхода**

Открыть «Финансы → Расходы → Новый расход», убедиться, что блок «Как провести в ОПИУ» работает как раньше (4 режима, превью амортизации), расход создаётся.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/opiu-recognition-fieldset.tsx app/src/app/(dashboard)/finance/expenses/add-expense-dialog.tsx
git commit -m "refactor(finance): вынести общий fieldset «Как провести в ОПИУ» (DRY)"
```

---

## Task 9: Вкладки «Сдельная»/«Оклады» на странице «Зарплата»

**Files:**
- Modify: `app/src/app/(dashboard)/salary/page.tsx` (20-294)

- [ ] **Step 1: Классифицировать сотрудников и разбить ведомость по вкладкам**

В `salary/page.tsx` после построения `rows` (после строки 120, `.filter(...)`) добавить классификацию и чтение активной вкладки:

```ts
  const sp = await searchParams
  const activeTab = sp.tab === "salary" ? "salary" : "piece"

  // Классификация по источнику ЗП (спека Р6/Р7):
  //  • «Оклады» — у кого задан оклад в карточке (monthlySalary>0).
  //  • «Сдельная» — у кого есть начисление за занятия.
  //  Совмещающий попадает в обе вкладки (в каждой — своя часть).
  const okladIds = new Set(employees.filter((e) => Number(e.monthlySalary) > 0).map((e) => e.id))
```

> Примечание: `searchParams` уже читается через `getMonthFromParams(await searchParams)` в начале. Чтобы не await-ить дважды, поднять `const sp = await searchParams` в начало функции и заменить `getMonthFromParams(await searchParams)` на `getMonthFromParams(sp)`.

- [ ] **Step 2: Вычислить отдельные наборы строк и итогов для каждой вкладки**

Строки ведомости уже содержат `accrued` = сделка + оклад. Для вкладок нужно разделить. Заменить блок построения `rows` (110-121) так, чтобы хранить сделочную и оклад-части отдельно:

```ts
  const rows = employees.map((emp) => {
    const name = [emp.lastName, emp.firstName].filter(Boolean).join(" ") || "Без имени"
    const pieceAccrued = accrualsByEmployee.get(emp.id) || 0
    const okladAccrued = Number(emp.monthlySalary) || 0
    const bonuses = bonusesByEmployee.get(emp.id) || 0
    const penalties = penaltiesByEmployee.get(emp.id) || 0
    const paid = paidByEmployee.get(emp.id) || 0
    const accrued = pieceAccrued + okladAccrued
    const remaining = accrued + bonuses - penalties - paid
    const substitutions = substituteLessonCount.get(emp.id) || 0
    return { id: emp.id, name, role: emp.role, pieceAccrued, okladAccrued, accrued, bonuses, penalties, paid, remaining, substitutions }
  })
```

Затем сформировать наборы вкладок (после классификации из Step 1):

```ts
  const pieceRows = rows.filter((r) => r.pieceAccrued > 0)
  const salaryRows = rows.filter((r) => okladIds.has(r.id))
  const tabRows = activeTab === "salary" ? salaryRows : pieceRows
  const displayRows = tabRows.length > 0 ? tabRows : []
```

> Итоги (`totalAccrued` и т.д.) считать по `displayRows` — оставить существующие reduce, но по `displayRows`. Для вкладки «Оклады» «Начислено» показывает оклад-часть; для этого в рендере строки использовать `activeTab === "salary" ? r.okladAccrued : r.pieceAccrued` для колонки «Начислено» (чтобы вкладка не смешивала). Обновить и `salaryExportRows`/`summary` аналогично.

- [ ] **Step 3: Отрисовать переключатель вкладок и per-tab кнопки**

Заменить хедер с кнопками (168-205). Табы делаем ссылками (сохраняем месяц), кнопки действий получают `kind` активной вкладки. Вставить перед `<div className="flex items-center gap-2">` (блок кнопок) переключатель:

```tsx
        <div className="flex flex-wrap items-center gap-2 border-b pb-2">
          <Link href={`/salary?year=${year}&month=${month}&tab=piece`}>
            <Badge variant={activeTab === "piece" ? "default" : "outline"} className="cursor-pointer">Сдельная</Badge>
          </Link>
          <Link href={`/salary?year=${year}&month=${month}&tab=salary`}>
            <Badge variant={activeTab === "salary" ? "default" : "outline"} className="cursor-pointer">Оклады</Badge>
          </Link>
        </div>
```

Кнопку «Документ выплат» — вести на форму с параметром вкладки:

```tsx
          <Link href={`/salary/payments/new?year=${year}&month=${month}&kind=${activeTab === "salary" ? "salary" : "piece"}`}>
            <Button variant="outline"><FileText className="mr-2 size-4" />Документ выплат</Button>
          </Link>
```

`PaySalaryDialog` — передать `kind`:

```tsx
          <PaySalaryDialog
            employees={displayRows.map(r => ({ id: r.id, name: r.name, remaining: r.remaining }))}
            accounts={accounts}
            periodYear={year}
            periodMonth={month}
            kind={activeTab === "salary" ? "salary" : "piece"}
          />
```

- [ ] **Step 4: Подключить список проведённых выплат (заготовка под Task 12)**

Под ведомостью добавить плейсхолдер компонента (реализуется в Task 12):

```tsx
      <ConductedPaymentsList year={year} month={month} kind={activeTab === "salary" ? "salary" : "piece"} />
```

и импорт вверху: `import { ConductedPaymentsList } from "@/components/salary/conducted-payments-list"`.

> Если Task 12 ещё не сделан, временно закомментировать этот блок, чтобы не ломать сборку; раскомментировать в Task 12.

- [ ] **Step 5: Типпроверка**

Run: `cd app && npx tsc --noEmit`
Expected: без ошибок (кроме отсутствия `ConductedPaymentsList`, если Task 12 не сделан — тогда блок из Step 4 держать закомментированным).

- [ ] **Step 6: Commit**

```bash
git add app/src/app/(dashboard)/salary/page.tsx
git commit -m "feat(salary): вкладки «Сдельная»/«Оклады» с классификацией по источнику ЗП"
```

---

## Task 10: Блок ОПИУ в «Провести выплату» (простой диалог)

**Files:**
- Modify: `app/src/app/(dashboard)/salary/pay-salary-dialog.tsx`

- [ ] **Step 1: Принять prop `kind` и добавить состояние признания**

В сигнатуру компонента добавить `kind`:

```tsx
export function PaySalaryDialog({
  employees, accounts, periodYear, periodMonth, kind,
}: {
  employees: EmployeeOption[]; accounts: AccountOption[]; periodYear: number; periodMonth: number; kind: "salary" | "piece"
}) {
```

Добавить импорты и состояние (месяц признания по умолчанию = период начисления):

```tsx
import { OpiuRecognitionFieldset, type OpiuRecognitionState } from "@/components/opiu-recognition-fieldset"
import { resolveRecognition } from "@/lib/expense-recognition"
```
```tsx
  const periodMonthStr = `${periodYear}-${String(periodMonth).padStart(2, "0")}`
  const [opiu, setOpiu] = useState<OpiuRecognitionState>({
    recognitionMode: "single_period", singleMonth: periodMonthStr, amortStartMonth: periodMonthStr, amortMonths: "3",
  })
```

- [ ] **Step 2: Добавить kind + recognition в тело POST**

В `handleSubmit`, перед `fetch`, разрешить признание и собрать поля:

```tsx
    let recognition = { recognitionMode: "by_payment_date" as const, amortizationStartDate: undefined as string | undefined, amortizationMonths: undefined as number | undefined }
    if (kind === "salary") {
      try { recognition = resolveRecognition(opiu) } catch (err) { setError(err instanceof Error ? err.message : "Ошибка признания"); return }
    }
```

Тело POST заменить на:

```tsx
        body: JSON.stringify({
          kind,
          employeeId,
          accountId,
          amount: Number(amount),
          date,
          periodYear,
          periodMonth,
          comment: comment || undefined,
          recognitionMode: recognition.recognitionMode,
          amortizationStartDate: recognition.amortizationStartDate,
          amortizationMonths: recognition.amortizationMonths,
        }),
```

- [ ] **Step 3: Отрисовать fieldset только для окладов**

В форме диалога, после блока «Счёт» (перед «Комментарий»), добавить:

```tsx
          {kind === "salary" && (
            <OpiuRecognitionFieldset value={opiu} onChange={setOpiu} amount={Number(amount) || 0} sym={sym} />
          )}
```

- [ ] **Step 4: Типпроверка**

Run: `cd app && npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/(dashboard)/salary/pay-salary-dialog.tsx
git commit -m "feat(salary): блок «Как провести в ОПИУ» в диалоге выплаты оклада"
```

---

## Task 11: Блок ОПИУ в «Документ выплат»

**Files:**
- Modify: `app/src/app/(dashboard)/salary/payments/new/page.tsx`

- [ ] **Step 1: Прочитать `kind` из URL и добавить состояние признания**

В `NewSalaryPaymentForm` после чтения `qYear`/`qMonth` добавить:

```tsx
  const kind = searchParams.get("kind") === "salary" ? "salary" : "piece"
  const periodMonthStr = `${periodYear}-${String(periodMonth).padStart(2, "0")}`
  const [opiu, setOpiu] = useState<OpiuRecognitionState>({
    recognitionMode: "single_period", singleMonth: periodMonthStr, amortStartMonth: periodMonthStr, amortMonths: "3",
  })
```

И импорты:

```tsx
import { OpiuRecognitionFieldset, type OpiuRecognitionState } from "@/components/opiu-recognition-fieldset"
import { resolveRecognition } from "@/lib/expense-recognition"
```

- [ ] **Step 2: Добавить kind + recognition в тело POST**

В `handleSubmit`, перед `fetch`, добавить разрешение признания:

```tsx
    let recognition = { recognitionMode: "by_payment_date" as const, amortizationStartDate: undefined as string | undefined, amortizationMonths: undefined as number | undefined }
    if (kind === "salary") {
      try { recognition = resolveRecognition(opiu) } catch (err) { setError(err instanceof Error ? err.message : "Ошибка признания"); return }
    }
```

В теле POST (после `items: items.map(...)`) добавить поля:

```tsx
          kind,
          recognitionMode: recognition.recognitionMode,
          amortizationStartDate: recognition.amortizationStartDate,
          amortizationMonths: recognition.amortizationMonths,
```

(добавить `kind` также в начало объекта body — рядом с `date`).

- [ ] **Step 3: Отрисовать fieldset рядом с итогами (только для окладов)**

Перед блоком «Итого к выплате» (footer bar, ~618) вставить:

```tsx
      {kind === "salary" && items.length > 0 && (
        <OpiuRecognitionFieldset value={opiu} onChange={setOpiu} amount={totalAmount} sym={currencySym} />
      )}
```

- [ ] **Step 4: Заголовок формы отражает тип**

Найти заголовок страницы (h1 «Документ выплаты…») и добавить суффикс по типу, например: `{kind === "salary" ? " (оклады)" : " (сдельная)"}`. (Уточнить точную строку h1 в файле.)

- [ ] **Step 5: Типпроверка**

Run: `cd app && npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/(dashboard)/salary/payments/new/page.tsx
git commit -m "feat(salary): блок «Как провести в ОПИУ» в документе выплат окладов"
```

---

## Task 12: UI — список проведённых выплат с «Изменить»/«Аннулировать»

**Files:**
- Create: `app/src/components/salary/conducted-payments-list.tsx`
- Modify: `app/src/app/api/salary-payments/route.ts` (GET — добавить фильтр kind при необходимости)

- [ ] **Step 1: Реализовать клиентский список выплат периода**

Создать `app/src/components/salary/conducted-payments-list.tsx` — загружает `GET /api/salary-payments?year&month`, показывает строки (сотрудник, сумма, счёт, дата, признак «оклад» если есть твин), кнопки «Аннулировать» (`DELETE /api/salary-payments/[id]`) и «Изменить» (открывает диалог с суммой/счётом/датой + при оклад-типе — `OpiuRecognitionFieldset`, шлёт `PATCH`). После действия — `router.refresh()`.

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

interface PaymentRow {
  id: string
  amount: number
  date: string
  employeeName: string
  accountName: string
  isOklad: boolean
}

export function ConductedPaymentsList({ year, month, kind }: { year: number; month: number; kind: "salary" | "piece" }) {
  const router = useRouter()
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/salary-payments?year=${year}&month=${month}&kind=${kind}`)
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : d.data ?? []))
      .catch(() => setRows([]))
  }, [year, month, kind])

  async function annul(id: string) {
    if (!confirm("Аннулировать выплату? Деньги вернутся на счёт, расход в ОПИУ снимется.")) return
    setBusy(id)
    try {
      const res = await fetch(`/api/salary-payments/${id}`, { method: "DELETE" })
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Ошибка"); return }
      router.refresh()
      setRows((prev) => prev.filter((r) => r.id !== id))
    } finally { setBusy(null) }
  }

  if (rows.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Проведённые выплаты за период</CardTitle></CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Сотрудник</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead>Счёт</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.employeeName}</TableCell>
                  <TableCell>{r.date}</TableCell>
                  <TableCell>{r.accountName}</TableCell>
                  <TableCell className="text-right">{new Intl.NumberFormat("ru-RU").format(r.amount)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" disabled={busy === r.id} onClick={() => annul(r.id)}>
                      Аннулировать
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
```

> «Изменить» (PATCH-диалог с `OpiuRecognitionFieldset`) реализовать по образцу PaySalaryDialog. Для первой итерации достаточно «Аннулировать» (главный сценарий «ошибочные проведения»); диалог правки добавить, если владельцу нужен in-place edit без пересоздания.

- [ ] **Step 2: Убедиться, что GET возвращает нужные поля (+ фильтр kind)**

В `GET /api/salary-payments` (route.ts:60-94) проверить, что ответ включает `employee` (имя), `account.name`, `amount`, `date`, и признак оклад-типа. Если нет — расширить `select` и добавить в объект строки `isOklad: <есть ли связанный Expense.salaryPaymentId>` (через `_count` или `opiuExpenses`), и опциональный фильтр `kind` (по наличию твина). Держать обратную совместимость формы ответа (массив или `{data}`), которую ждёт клиент.

- [ ] **Step 3: Снять комментарий с `<ConductedPaymentsList/>` в salary/page.tsx (Task 9 Step 4)**

- [ ] **Step 4: Типпроверка + дым**

Run: `cd app && npx tsc --noEmit`
Провести тестовую оклад-выплату → строка появляется → «Аннулировать» → деньги возвращаются, твин-расход исчезает (проверить в «Расходах»).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/salary/conducted-payments-list.tsx app/src/app/api/salary-payments/route.ts app/src/app/(dashboard)/salary/page.tsx
git commit -m "feat(salary): список проведённых выплат + аннулирование (owner/manager)"
```

---

## Task 13: Справка (PageHelp) + ai-context

**Files:**
- Modify: `app/src/lib/page-help-content.ts` (ключи: `salary` ~1081, `salary/payments/new` ~1811, `finance/expenses` 924-925, `reports/finance/pnl` ~2743)
- Modify: `app/src/lib/ai-context.ts` (разделы оклад/выплаты/P&L ~345-360)

- [ ] **Step 1: Обновить справку страницы «Зарплата» (ключ `salary`)**

Описать: две вкладки «Сдельная»/«Оклады»; окладник виден в обеих (оклад + сделка); при выплате оклада выбирается «Как провести в ОПИУ»; выплата оклада создаёт расход в категории «Зарплата окладников» и попадает в финрез при проведении; проведённые выплаты можно аннулировать (владелец/управляющий).

- [ ] **Step 2: Обновить `finance/expenses` строки 924-925**

Заменить устаревшее «ЗП инструкторов вносится вручную» на актуальное: оклад окладников попадает в расходы автоматически из модуля «Зарплата» (категория «Зарплата окладников», признаётся по блоку ОПИУ); сдельная ЗП инструкторов — начисление по занятиям (в ОПИУ отдельной строкой, не расходом).

- [ ] **Step 3: Обновить `reports/finance/pnl` (структура ЗП)**

Описать: «ЗП инструкторов (начислено)» — сдельная по занятиям (переменные); оклады — в постоянных расходах категорией «Зарплата окладников» (по проведённым выплатам с признанием); фантомного авто-оклада больше нет.

- [ ] **Step 4: Обновить ai-context.ts**

В FAQ про оклад/выплаты/P&L отразить: оклад = расход при выплате (твин, категория «Зарплата окладников»), вкладки Сдельная/Оклады, аннулирование выплат.

- [ ] **Step 5: Типпроверка + commit**

Run: `cd app && npx tsc --noEmit`
```bash
git add app/src/lib/page-help-content.ts app/src/lib/ai-context.ts
git commit -m "docs(help): справка и ai-context под оклад-расход и вкладки зарплаты"
```

---

## Task 14: E2E-сценарий (Playwright) + финальная проверка

**Files:**
- Modify/Create: `app/tests/salary-oklad-opiu.spec.ts` (новый спек или расширение `mega-accounting-march.spec.ts`)

- [ ] **Step 1: Написать e2e-сценарий**

Сценарий (против seeded dev-сервера, `TEST_BASE_URL`): вход как owner → «Зарплата» → вкладка «Оклады» → «Провести выплату» окладнику с блоком «Как провести в ОПИУ» (single_period, месяц периода) → проверить, что в «Финансы → Расходы» появился расход категории «Зарплата окладников» без счёта; в «Отчёты → P&L» за месяц признания оклад виден в постоянных расходах; в «ДДС» выплата видна один раз → «Аннулировать» → расход и строка ДДС исчезают, баланс счёта восстановлен.

```ts
import { test, expect } from "@playwright/test"
// ... логин-хелпер как в существующих spec (tests/ содержат образцы авторизации owner) ...

test("оклад: выплата создаёт расход в ОПИУ один раз и аннулируется", async ({ page }) => {
  // 1. Логин owner (скопировать паттерн из tests/mega-accounting-march.spec.ts)
  // 2. Перейти /salary?tab=salary, провести выплату окладнику с recognition=single_period
  // 3. Проверить наличие расхода «Зарплата окладников» в /finance/expenses
  // 4. Проверить оклад в /reports/finance/pnl (постоянные расходы)
  // 5. Аннулировать в списке проведённых выплат; проверить исчезновение расхода
})
```

> Точный селекторный код заполнить по образцу существующих spec в `app/tests/` (там есть рабочие логин-хелперы и навигация по этим же страницам).

- [ ] **Step 2: Прогнать unit-набор целиком**

Run: `cd app && npm run test:unit`
Expected: PASS (включая `expense-recognition`, `oklad-twin`, `expense-amortization`).

- [ ] **Step 3: Прогнать e2e против dev**

Run: `cd app && TEST_BASE_URL=https://dev.umnayacrm.ru npx playwright test tests/salary-oklad-opiu.spec.ts`
Expected: PASS (после деплоя ветки на dev). Если dev не обновлён — прогнать локально с `npm run dev`.

- [ ] **Step 4: Полная типпроверка + build**

Run: `cd app && npx tsc --noEmit && npm run build`
Expected: без ошибок.

- [ ] **Step 5: Commit + push + проверить CI**

```bash
git add app/tests/salary-oklad-opiu.spec.ts
git commit -m "test(salary): e2e оклад→расход→ОПИУ→аннулирование"
git push -u origin feature/salary-expenses-opiu
```
После push — проверить CI (CLAUDE.md §CI/CD): `gh run list --repo denshimansky/crmka --limit 1`. Если упал — починить до продолжения.

---

## Порядок и зависимости

1. **Task 1** (модель/миграция/категория) — фундамент, первым.
2. **Task 2, 3** (чистые функции) — параллельно, независимы.
3. **Task 4** (создание твина) — после 1, 3.
4. **Task 5** (редактор API) — после 1, 3.
5. **Task 6, 7** (отчёты/forecast) — после 1 (независимы от UI).
6. **Task 8** (fieldset) — после 2.
7. **Task 9, 10, 11** (UI вкладки/диалоги) — после 8; 10/11 зависят от 4 (API kind).
8. **Task 12** (список выплат) — после 5, 9.
9. **Task 13** (справка) — после UI готова.
10. **Task 14** (e2e/финал) — последним.

## Проверка на двойной счёт (обязательный ручной чек перед мержем)

На тестовой орг с окладником за месяц M:
- ОПИУ (страница `/reports/finance/pnl`): оклад ровно один раз (постоянные, «Зарплата окладников»); сдельная — в переменных; итог `netProfit` уменьшился на оклад.
- ДДС (`/finance/dds`): выплата оклада одна строка (через `SalaryPayment`); твин-расход (`accountId=NULL`) в ДДС НЕ виден.
- Ведомость «Оклады»: «Выплачено»/«Осталось» корректны.
- Аннулирование: баланс счёта восстановлен, твин-расход и строка ДДС исчезли.

## Развёртывание (20 организаций)

- Миграция `20260802120000_oklad_expense_twin` применяется автодеплоем (push в main после мержа ветки). Категория «Зарплата окладников» засеивается идемпотентно для всех тенантов (tenant_id=NULL).
- Перед мержем — read-only проверка на msk1: нет ли организаций, где оклад уже заводили вручную расходом в isSalary-категории (иначе после релиза возможен двойной счёт — предупредить владельцев переходить на новый flow). См. память `reference_msk1_db_access`.
