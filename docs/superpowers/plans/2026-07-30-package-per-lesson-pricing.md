# Цена занятия по пакетам (баг #89) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать пакетным орг задавать цену занятия на каждый пакет в рамках направления и подставлять её (+ итог + срок) при выписке абонемента и в воронке заявок.

**Architecture:** Базовая `Direction.lessonPrice` + необязательные JSON-переопределения `Direction.packagePrices = { packageTemplateId: ценаЗанятия }`. Единый хелпер `packageLessonPrice()` — точка правды. Заявка получает `packageTemplateId`; конвертация заявка→абонемент достраивается пакетной веткой (сейчас жёстко calendar).

**Tech Stack:** Next.js (App Router), Prisma/PostgreSQL, TypeScript, zod, React (shadcn/ui). Тесты: `node --test` + tsx (`npm run test:unit`).

**Spec:** `docs/superpowers/specs/2026-07-30-package-per-lesson-pricing-design.md`

---

### Task 1: Схема + миграция

**Files:**
- Modify: `app/prisma/schema.prisma` (Direction ~442-471, Application ~2078-2125, PackageTemplate ~820-836)
- Create: миграция через `prisma migrate dev`

- [ ] **Step 1: Добавить поля в schema.prisma**

В `model Direction` после `singleVisitPrice`:
```prisma
  packagePrices    Json?     @map("package_prices")   // { packageTemplateId: ценаЗанятия } — переопределения для пакетного типа
```
В `model Application` после `directionId`:
```prisma
  packageTemplateId String?  @map("package_template_id") @db.Uuid
```
В `model Application` в блок relations:
```prisma
  packageTemplate   PackageTemplate? @relation(fields: [packageTemplateId], references: [id], onDelete: SetNull)
```
В `model PackageTemplate` в back-relations (рядом с `subscriptions Subscription[]`):
```prisma
  applications  Application[]
```

- [ ] **Step 2: Сгенерировать миграцию**

Run: `cd app && npx prisma migrate dev --name package_pricing --create-only`
Проверить сгенерированный SQL: `ALTER TABLE "directions" ADD COLUMN "package_prices" JSONB;` и `ALTER TABLE "applications" ADD COLUMN "package_template_id" UUID;` + FK на `package_templates(id) ON DELETE SET NULL`. Аддитивно, nullable — безопасно.

- [ ] **Step 3: Применить + сгенерировать клиент**

Run: `cd app && npx prisma migrate dev && npx prisma generate`
Expected: миграция применена, Prisma Client перегенерирован.

- [ ] **Step 4: Commit**
```bash
git add app/prisma/schema.prisma app/prisma/migrations
git commit -m "feat(db): Direction.packagePrices + Application.packageTemplateId (#89)"
```

---

### Task 2: Хелпер `packageLessonPrice` + unit-тест (TDD)

**Files:**
- Create: `app/src/lib/subscriptions/package-price.ts`
- Test: `app/src/__tests__/package-price.test.ts`

- [ ] **Step 1: Написать падающий тест**
```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { packageLessonPrice } from "../lib/subscriptions/package-price"

test("override пакета имеет приоритет", () => {
  const dir = { lessonPrice: 500, packagePrices: { "tpl-8": 400 } }
  assert.equal(packageLessonPrice(dir, "tpl-8"), 400)
})
test("нет override → базовая цена", () => {
  const dir = { lessonPrice: 500, packagePrices: { "tpl-8": 400 } }
  assert.equal(packageLessonPrice(dir, "tpl-12"), 500)
})
test("нет templateId → базовая цена", () => {
  assert.equal(packageLessonPrice({ lessonPrice: 500, packagePrices: null }, undefined), 500)
})
test("packagePrices null/невалидный → базовая", () => {
  assert.equal(packageLessonPrice({ lessonPrice: 500, packagePrices: null }, "x"), 500)
  assert.equal(packageLessonPrice({ lessonPrice: "500", packagePrices: {} as any }, "x"), 500)
})
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd app && node --import tsx --test src/__tests__/package-price.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Реализовать**
```ts
// Цена занятия для пакетного абонемента: пер-пакетное переопределение направления
// или базовая lessonPrice. Decimal приходит как Prisma.Decimal|string|number — нормализуем.
export type PricedDirection = {
  lessonPrice: number | string | { toString(): string }
  packagePrices?: Record<string, number> | null | unknown
}

export function packageLessonPrice(
  direction: PricedDirection,
  packageTemplateId?: string | null,
): number {
  const base = Number(direction.lessonPrice)
  if (!packageTemplateId) return base
  const map = direction.packagePrices
  if (!map || typeof map !== "object") return base
  const v = (map as Record<string, unknown>)[packageTemplateId]
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : base
}
```

- [ ] **Step 4: Запустить — пройдёт**

Run: `cd app && node --import tsx --test src/__tests__/package-price.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add app/src/lib/subscriptions/package-price.ts app/src/__tests__/package-price.test.ts
git commit -m "feat(subscriptions): packageLessonPrice helper (#89)"
```

---

### Task 3: Directions API — приём/валидация/хранение `packagePrices`

**Files:**
- Modify: `app/src/app/api/directions/route.ts` (createSchema ~8-20, create ~62-73)
- Modify: `app/src/app/api/directions/[id]/route.ts` (updateSchema ~8-20, update ~55)

- [ ] **Step 1: Добавить в обе zod-схемы**

Общая валидация (в оба файла): значение — карта строк→неотрицательные числа; пустые/невалидные значения выкидываем; ключи не проверяем на существование шаблона (сироты безвредны — хелпер их игнорирует).
```ts
packagePrices: z
  .record(z.string(), z.coerce.number().min(0))
  .transform((m) => {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(m)) if (Number.isFinite(v) && v >= 0) out[k] = v
    return out
  })
  .nullable()
  .optional(),
```

- [ ] **Step 2: Сохранять в create (route.ts)**

В `db.direction.create({ data: { ... } })` добавить:
```ts
      packagePrices: parsed.data.packagePrices ?? undefined,
```

- [ ] **Step 3: Сохранять в update ([id]/route.ts)**

`db.direction.update({ data: parsed.data })` уже прокинет `packagePrices` (partial). Убедиться, что `parsed.data` включает поле; ничего дополнительно не нужно, кроме схемы из Step 1.

- [ ] **Step 4: Тест (integration, по образцу существующих в __tests__)**

Добавить в существующий directions-тест (или создать `app/src/__tests__/directions-package-prices.test.ts`) проверку: POST направления с `packagePrices: {"a": 400, "b": -5, "c": "x"}` → сохранены только валидные `{a:400}`; отрицательные/нечисловые отброшены. Использовать тот же bootstrap, что и соседние API-тесты (сессия owner). Если в окружении нет БД — тест помечается «требует seed», как соседние; тогда полагаться на tsc + ручную проверку.

- [ ] **Step 5: Проверить типы**

Run: `cd app && npx tsc --noEmit`
Expected: чисто.

- [ ] **Step 6: Commit**
```bash
git add app/src/app/api/directions
git commit -m "feat(directions): API принимает packagePrices (#89)"
```

---

### Task 4: Форма направления — секция «Цены по пакетам»

**Files:**
- Modify: `app/src/app/(dashboard)/settings/create-direction-dialog.tsx`
- Modify: `app/src/app/(dashboard)/settings/edit-direction-dialog.tsx`

- [ ] **Step 1: Общий блок состояния и загрузки (оба диалога)**

Добавить fetch при открытии: `GET /api/organization` (взять `subscriptionType`) и `GET /api/package-templates` (список активных `{id, lessonsCount, validDays}`). Хранить `isPackageOrg: boolean`, `templates: PackageTemplateOption[]`, и стейт `packagePrices: Record<string,string>` (строки инпутов).

- [ ] **Step 2: UI-секция (рендерить только при `isPackageOrg && templates.length`)**
```tsx
{isPackageOrg && templates.length > 0 && (
  <div className="space-y-1.5">
    <Label>Цены по пакетам</Label>
    <div className="space-y-2">
      {templates.map((t) => (
        <div key={t.id} className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-sm text-muted-foreground">{t.lessonsCount} занятий</span>
          <Input
            type="number" min={0}
            placeholder={lessonPrice || "базовая"}
            value={packagePrices[t.id] ?? ""}
            onChange={(e) => setPackagePrices((p) => ({ ...p, [t.id]: e.target.value }))}
          />
          <span className="text-sm text-muted-foreground">{/* символ валюты через useCurrencySymbol */}</span>
        </div>
      ))}
    </div>
    <p className="text-xs text-muted-foreground">Пусто — берётся базовая цена занятия.</p>
  </div>
)}
```
Использовать `useCurrencySymbol()` из `@/components/currency-provider` (диалоги под (dashboard)).

- [ ] **Step 3: Собрать payload**

В POST/PATCH body добавить `packagePrices`: из `packagePrices` стейта собрать `{ [id]: Number(v) }` только по непустым числовым значениям; если пусто → не слать (или `null`). В edit-диалоге инициализировать стейт из `direction.packagePrices`.

- [ ] **Step 4: Проверить типы + прогнать**

Run: `cd app && npx tsc --noEmit`
Expected: чисто. Ручной прогон формы (см. Task 12).

- [ ] **Step 5: Commit**
```bash
git add "app/src/app/(dashboard)/settings/create-direction-dialog.tsx" "app/src/app/(dashboard)/settings/edit-direction-dialog.tsx"
git commit -m "feat(directions): форма цен по пакетам (#89)"
```

---

### Task 5: Список направлений — прокинуть `packagePrices` в правку

**Files:**
- Modify: `app/src/app/(dashboard)/settings/directions/page.tsx` (~92-104), `edit-direction-dialog.tsx` тип `DirectionData`, `create-direction-dialog.tsx` тип `CreatedDirection`

- [ ] **Step 1:** В `DirectionData` (edit) и `CreatedDirection` (create) добавить `packagePrices?: Record<string, number> | null`.
- [ ] **Step 2:** В `settings/directions/page.tsx` при маппинге строки направления в проп `EditRoomDialog`→`EditDirectionDialog` передать `packagePrices: d.packagePrices as Record<string,number> | null`.
- [ ] **Step 3:** `npx tsc --noEmit` — чисто.
- [ ] **Step 4: Commit**
```bash
git add "app/src/app/(dashboard)/settings/directions/page.tsx" "app/src/app/(dashboard)/settings/edit-direction-dialog.tsx" "app/src/app/(dashboard)/settings/create-direction-dialog.tsx"
git commit -m "feat(directions): packagePrices в форму правки (#89)"
```

---

### Task 6: Ручная выписка — авто-цена при выборе пакета

**Files:**
- Modify: `app/src/app/(dashboard)/crm/clients/[id]/client-tabs.tsx` (DirectionOption ~1281, package select ~1438-1447)

- [ ] **Step 1:** В тип `DirectionOption` добавить `packagePrices?: Record<string, number> | null`.
- [ ] **Step 2:** В обработчике выбора шаблона пакета (где сейчас ставятся `totalLessons`+`validDays`) добавить установку цены:
```ts
import { packageLessonPrice } from "@/lib/subscriptions/package-price"
// при выборе шаблона tpl и выбранном направлении dir:
const dir = directions.find((d) => d.id === directionId)
if (dir) setLessonPrice(String(packageLessonPrice({ lessonPrice: Number(dir.lessonPrice), packagePrices: dir.packagePrices }, tpl.id)))
```
Цена остаётся редактируемой (просто пере-заполняется при выборе пакета).
- [ ] **Step 3:** `/api/directions` уже возвращает `packagePrices` (скалярное JSON-поле, включается по умолчанию) — убедиться, что маппинг в `DirectionOption` его переносит.
- [ ] **Step 4:** `npx tsc --noEmit` — чисто.
- [ ] **Step 5: Commit**
```bash
git add "app/src/app/(dashboard)/crm/clients/[id]/client-tabs.tsx"
git commit -m "feat(subscriptions): пакетная цена в форме выписки (#89)"
```

---

### Task 7: Applications API — `packageTemplateId`

**Files:**
- Modify: `app/src/app/api/applications/route.ts` (createSchema ~16-25, create ~142-158)

- [ ] **Step 1:** В `createSchema` добавить `packageTemplateId: z.string().uuid().nullable().optional()`.
- [ ] **Step 2:** В `Application.create({ data })` добавить `packageTemplateId: parsed.data.packageTemplateId ?? null`.
- [ ] **Step 3 (опц.):** Валидация — если передан, проверить, что шаблон принадлежит тенанту и активен (findFirst); иначе 400. (Мягко: можно опустить и полагаться на FK.)
- [ ] **Step 4:** `npx tsc --noEmit` — чисто.
- [ ] **Step 5: Commit**
```bash
git add app/src/app/api/applications/route.ts
git commit -m "feat(applications): приём packageTemplateId (#89)"
```

---

### Task 8: Форма заявки — селектор пакета

**Files:**
- Modify: `app/src/app/(dashboard)/crm/_components/create-application-dialog.tsx` (fetch ~109, payload ~194-201)

- [ ] **Step 1:** Догрузить `GET /api/organization` (взять `subscriptionType`, `packageDefaultValidDays`) и `GET /api/package-templates`. Хранить `isPackageOrg`, `templates`, `packageTemplateId: string | null`.
- [ ] **Step 2:** Рендерить сетку кнопок выбора пакета (по образцу `client-tabs.tsx:1723-1749`) только при `isPackageOrg && templates.length`. Показать пакетную цену выбранного направления: `packageLessonPrice(dir, packageTemplateId)`. Необязателен (можно не выбирать).
- [ ] **Step 3:** В payload добавить `packageTemplateId` (когда выбран).
- [ ] **Step 4:** `npx tsc --noEmit` — чисто.
- [ ] **Step 5: Commit**
```bash
git add "app/src/app/(dashboard)/crm/_components/create-application-dialog.tsx"
git commit -m "feat(applications): селектор пакета в форме заявки (#89)"
```

---

### Task 9: Диалог «Ожидаем оплату» — селектор пакета

**Files:**
- Modify: `app/src/app/(dashboard)/crm/_components/awaiting-payment-dialog.tsx` (fetch ~100-104, payload ~255-261)

- [ ] **Step 1:** Догрузить org (`subscriptionType`, `packageDefaultValidDays`) + `/api/package-templates`. Хранить `isPackageOrg`, `templates`, `packageTemplateId` (дефолт = `application.packageTemplateId`, приходит пропом или из заявки), `validDays`.
- [ ] **Step 2:** Для пакетных орг — сетка выбора пакета (обязателен), поле «Срок (дн.)» (дефолт из шаблона/орг), предпросмотр «Истекает = дата старта + срок» (по образцу `client-tabs.tsx:1773-1781`). Для не-пакетных — без изменений.
- [ ] **Step 3:** В payload добавить `packageTemplateId`, `validDays` (для пакетных); заблокировать submit, если пакетная орг и пакет не выбран.
- [ ] **Step 4:** `npx tsc --noEmit` — чисто.
- [ ] **Step 5: Commit**
```bash
git add "app/src/app/(dashboard)/crm/_components/awaiting-payment-dialog.tsx"
git commit -m "feat(applications): пакет в диалоге ожидания оплаты (#89)"
```

---

### Task 10: Конвертация — пакетная ветка в `move-to-awaiting-payment`

**Files:**
- Modify: `app/src/app/api/wards/[id]/move-to-awaiting-payment/route.ts` (moveSchema ~12-20, направление ~124-127, totalLessons ~152-167, sub create ~200-224)

- [ ] **Step 1:** В `moveSchema` добавить `packageTemplateId: z.string().uuid().nullable().optional()`, `validDays: z.number().int().min(1).max(3650).optional()`.
- [ ] **Step 2:** Прочитать `org.subscriptionType` (+ `packageDefaultValidDays`) — по образцу `subscriptions/route.ts:177-201`. Резолвить `packageTemplateId = body.packageTemplateId ?? application.packageTemplateId`.
- [ ] **Step 3:** Ветвление при создании абонемента:
```ts
import { packageLessonPrice } from "@/lib/subscriptions/package-price"
import { addDaysUtc } from "..." // либо локальный аналог как в subscriptions/route.ts:30-34

if (orgType === "package") {
  if (!packageTemplateId) return NextResponse.json({ error: "Выберите пакет" }, { status: 400 })
  const tpl = await tx.packageTemplate.findFirst({ where: { id: packageTemplateId, tenantId, deletedAt: null } })
  if (!tpl) return NextResponse.json({ error: "Пакет не найден" }, { status: 400 })
  const totalLessons = tpl.lessonsCount
  const lessonPrice = packageLessonPrice({ lessonPrice: Number(direction.lessonPrice), packagePrices: direction.packagePrices }, tpl.id)
  const validDays = body.validDays ?? tpl.validDays ?? org.packageDefaultValidDays
  const startDate = firstPaid // дата старта из firstPaidLessonDate
  const expiresAt = addDaysUtc(startDate, validDays)
  // create: type:"package", periodYear:null, periodMonth:null, lessonPrice, totalLessons,
  //   totalAmount: lessonPrice*totalLessons, finalAmount, balance, startDate, expiresAt, packageTemplateId
} else {
  // существующая календарная ветка без изменений
}
```
Общие поля (client/ward/direction/group/createdBy/enrollment/стадия заявки/recalc) — вынести из ветвления, чтобы не дублировать.
- [ ] **Step 4: Тест конвертации (по образцу соседних API-тестов)**

Проверить: для package-орг заявка с `packageTemplateId` → создаётся `type:"package"`, `totalLessons = lessonsCount`, `lessonPrice = packageLessonPrice`, `expiresAt = startDate+validDays`, `periodYear/Month = null`, `packageTemplateId` проставлен. (Если БД недоступна — «требует seed» + tsc.)
- [ ] **Step 5:** `npx tsc --noEmit` — чисто.
- [ ] **Step 6: Commit**
```bash
git add app/src/app/api/wards/"[id]"/move-to-awaiting-payment/route.ts
git commit -m "feat(applications): пакетная ветка конвертации заявки (#89)"
```

---

### Task 11: PageHelp

**Files:**
- Modify: `app/src/lib/page-help-content.ts`

- [ ] **Step 1:** Обновить тексты справки страниц: направления (упомянуть цены по пакетам), выписка абонемента и заявка/ожидаем оплату (упомянуть выбор пакета и авто-подстановку цены/срока). Найти нужные ключи (`settings/directions` или соответствующий, `crm/...`).
- [ ] **Step 2: Commit**
```bash
git add app/src/lib/page-help-content.ts
git commit -m "docs(help): справка по ценам/пакетам (#89)"
```

---

### Task 12: Финальная верификация + деплой

- [ ] **Step 1:** `cd app && npx tsc --noEmit` — чисто.
- [ ] **Step 2:** `cd app && npm run test:unit` — новые тесты зелёные; прежние без регрессий (кроме заранее известных «требует seed» интеграционных).
- [ ] **Step 3:** Ручной прогон (по возможности) на dev/локально: создать направление с пакетными ценами → выписать пакетный абонемент (цена/итог/срок подставились) → создать заявку с пакетом → конвертировать (получился package-абонемент с пакетной ценой).
- [ ] **Step 4: Push (автодеплой) + проверить CI**
```bash
git push origin main
gh run list --repo denshimansky/crmka --limit 3
```
Дождаться `Deploy to Timeweb` success. Прод-миграция применится через `prisma migrate deploy` в деплое.

---

## Self-Review

- **Покрытие спеки:** данные (Task 1), хелпер (2), directions API+форма (3–5), выписка (6), заявка API+форма (7–8), конвертация (9–10), PageHelp (11), тесты (2,3,10,12). Все разделы спеки покрыты.
- **Плейсхолдеры:** UI-задачи (4,8,9) описывают приём/паттерн с опорой на конкретные строки-образцы (`client-tabs.tsx:1723-1783`) вместо полного дублирования большого JSX — это осознанно (переиспользование существующего паттерна), не «TODO».
- **Согласованность типов:** `packageLessonPrice(direction, templateId?)` с `PricedDirection {lessonPrice, packagePrices}` — одинаково в Tasks 2/6/10. `packagePrices: Record<string,number>|null` — одинаково в API/типах/форме.
- **Риск:** прод-миграция — аддитивная nullable, безопасна; деплой msk1 с известными quirks (см. memory `project_msk1_deploy_timeout`).
