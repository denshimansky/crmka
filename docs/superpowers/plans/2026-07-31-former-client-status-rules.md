# «Бывший клиент»: ограничение статусов — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Запретить перевод бывшего клиента в «Потенциальный» и дать ему попасть в «Выбывшие» из любого статуса (включая ЧС/Архив) одной кнопкой.

**Architecture:** Вся новая логика — в двух чистых, юнит-тестируемых функциях: `wasEverClient` (предикат) и `planFormerClientTransition` (решение серверного гарда) + `statusSelectorOptions` (набор опций селектора UI). Роут `PATCH /api/clients/[id]` и компонент `LeadStatusActions` — тонкие обёртки, которые их вызывают. Существующие гарды роута не переписываются.

**Tech Stack:** TypeScript, Next.js App Router, Prisma, node:test + tsx (юнит-тесты).

**Спека:** `docs/superpowers/specs/2026-07-31-former-client-status-rules-design.md`

---

### Task 1: Предикат `wasEverClient`

**Files:**
- Create: `app/src/lib/clients/was-ever-client.ts`
- Test: `app/src/__tests__/was-ever-client.test.ts`

- [ ] **Step 1: Написать падающий тест**

`app/src/__tests__/was-ever-client.test.ts`:

```ts
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { wasEverClient } from "../lib/clients/was-ever-client"

describe("wasEverClient", () => {
  const base = { firstPaymentDate: null, firstPaidLessonDate: null, clientStatus: null }

  it("чистый лид — false", () => {
    assert.equal(wasEverClient(base), false)
  })
  it("была первая оплата — true", () => {
    assert.equal(wasEverClient({ ...base, firstPaymentDate: new Date("2026-07-01") }), true)
  })
  it("было первое платное занятие (в т.ч. в долг) — true", () => {
    assert.equal(wasEverClient({ ...base, firstPaidLessonDate: new Date("2026-07-28") }), true)
  })
  it("сейчас активный — true", () => {
    assert.equal(wasEverClient({ ...base, clientStatus: "active" }), true)
  })
  it("сейчас выбывший — true", () => {
    assert.equal(wasEverClient({ ...base, clientStatus: "churned" }), true)
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd app && node --import tsx --test src/__tests__/was-ever-client.test.ts`
Expected: FAIL — `Cannot find module '../lib/clients/was-ever-client'`.

- [ ] **Step 3: Реализация**

`app/src/lib/clients/was-ever-client.ts`:

```ts
/**
 * «Бывший (или текущий) клиент» — кто хоть раз был активным. Долгоживущий
 * признак: занос в ЧС/Архив обнуляет clientStatus, но даты остаются. Никакой
 * миграции БД — сигнал берём из существующих полей.
 */
export function wasEverClient(c: {
  firstPaymentDate: Date | null
  firstPaidLessonDate: Date | null
  clientStatus: string | null
}): boolean {
  return (
    c.firstPaymentDate != null ||
    c.firstPaidLessonDate != null ||
    c.clientStatus === "active" ||
    c.clientStatus === "churned"
  )
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `cd app && node --import tsx --test src/__tests__/was-ever-client.test.ts`
Expected: PASS (5 тестов).

- [ ] **Step 5: Commit**

```bash
git -C /c/Users/Cyberjinn/Desktop/CRMKA add app/src/lib/clients/was-ever-client.ts app/src/__tests__/was-ever-client.test.ts
git -C /c/Users/Cyberjinn/Desktop/CRMKA commit -m "feat(clients): предикат wasEverClient (бывший клиент)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Серверное решение `planFormerClientTransition`

Чистая функция — единый источник правды для новых правил (R1: запрет Потенциального; R2: вывод из ЧС/Архива в Выбывшие + гейт роли; очистка clientStatus при переходе в воронковый бакет).

**Files:**
- Create: `app/src/lib/clients/former-client-status.ts`
- Test: `app/src/__tests__/former-client-status.test.ts`

- [ ] **Step 1: Написать падающий тест**

`app/src/__tests__/former-client-status.test.ts`:

```ts
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { planFormerClientTransition } from "../lib/clients/former-client-status"

const client = (over: Partial<{ funnelStatus: string; clientStatus: string | null; firstPaymentDate: Date | null; firstPaidLessonDate: Date | null }>) => ({
  funnelStatus: "active_client",
  clientStatus: null,
  firstPaymentDate: null,
  firstPaidLessonDate: new Date("2026-07-28"), // по умолчанию — бывший клиент
  ...over,
})

describe("planFormerClientTransition", () => {
  it("R1: бывшего клиента нельзя в Потенциальный", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "non_target" }),
      patchFunnelStatus: "potential",
      role: "owner",
    })
    assert.deepEqual(r, { error: "Бывшего клиента нельзя вернуть в «Потенциальный»", httpStatus: 400 })
  })

  it("R1: чистый лид → Потенциальный разрешено", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "new", firstPaidLessonDate: null }),
      patchFunnelStatus: "potential",
      role: "admin",
    })
    assert.deepEqual(r, { funnelStatusInject: null, clearClientStatus: false })
  })

  it("R1: уже Потенциальный, no-op сохранение — разрешено", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "potential" }),
      patchFunnelStatus: "potential",
      role: "owner",
    })
    assert.deepEqual(r, { funnelStatusInject: null, clearClientStatus: false })
  })

  it("R2: churned из ЧС под владельцем → вывод в active_client, clientStatus не чистим", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "blacklisted" }),
      patchClientStatus: "churned",
      role: "owner",
    })
    assert.deepEqual(r, { funnelStatusInject: "active_client", clearClientStatus: false })
  })

  it("R2: churned из Архива под управляющим → active_client", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "archived" }),
      patchClientStatus: "churned",
      role: "manager",
    })
    assert.deepEqual(r, { funnelStatusInject: "active_client", clearClientStatus: false })
  })

  it("R2: churned из ЧС под админом → 403", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "blacklisted" }),
      patchClientStatus: "churned",
      role: "admin",
    })
    assert.deepEqual(r, { error: "Только владелец или управляющий может вывести клиента из чёрного списка или архива", httpStatus: 403 })
  })

  it("churned НЕ из терминала (обычное отчисление) — без инъекции", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "active_client", clientStatus: "active" }),
      patchClientStatus: "churned",
      role: "admin",
    })
    assert.deepEqual(r, { funnelStatusInject: null, clearClientStatus: false })
  })

  it("бывший выбывший → Лид: чистим clientStatus", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "active_client", clientStatus: "churned" }),
      patchFunnelStatus: "new",
      role: "admin",
    })
    assert.deepEqual(r, { funnelStatusInject: null, clearClientStatus: true })
  })

  it("бывший выбывший → Не целевой: чистим clientStatus", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "active_client", clientStatus: "churned" }),
      patchFunnelStatus: "non_target",
      role: "admin",
    })
    assert.deepEqual(r, { funnelStatusInject: null, clearClientStatus: true })
  })

  it("вход в ЧС (archived/blacklisted) — чистим clientStatus (как раньше)", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "active_client", clientStatus: "active" }),
      patchFunnelStatus: "blacklisted",
      role: "admin",
    })
    assert.deepEqual(r, { funnelStatusInject: null, clearClientStatus: true })
  })

  it("явный clientStatus в теле → clientStatus не чистим", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "active_client", clientStatus: "churned" }),
      patchFunnelStatus: "new",
      patchClientStatus: "active",
      role: "admin",
    })
    assert.deepEqual(r, { funnelStatusInject: null, clearClientStatus: false })
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd app && node --import tsx --test src/__tests__/former-client-status.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализация**

`app/src/lib/clients/former-client-status.ts`:

```ts
import { wasEverClient } from "./was-ever-client"

// Воронковые «бакеты», при переходе в которые рабочий статус (active/churned)
// теряет смысл и обнуляется, чтобы метка отражала выбранный бакет. active_client
// сюда НЕ входит — при выводе в «Выбывшие» clientStatus=churned должен сохраниться.
const FUNNEL_BUCKETS = ["new", "non_target", "archived", "blacklisted"]
const TERMINAL = ["blacklisted", "archived"]

export type PlanExisting = {
  funnelStatus: string
  clientStatus: string | null
  firstPaymentDate: Date | null
  firstPaidLessonDate: Date | null
}

export type TransitionPlan =
  | { error: string; httpStatus: number }
  | { funnelStatusInject: "active_client" | null; clearClientStatus: boolean }

/**
 * Решение по правилам «бывшего клиента» для PATCH /api/clients/[id].
 * Чистая функция — единый источник правды, ловит и UI, и прямые вызовы API.
 */
export function planFormerClientTransition(input: {
  existing: PlanExisting
  patchFunnelStatus?: string
  patchClientStatus?: string | null // undefined = поле не пришло в теле
  role: string
}): TransitionPlan {
  const { existing, patchFunnelStatus, patchClientStatus, role } = input
  const wasClient = wasEverClient(existing)

  // R1: бывшего клиента нельзя вернуть в «Потенциальный» (переход именно В potential).
  if (wasClient && patchFunnelStatus === "potential" && existing.funnelStatus !== "potential") {
    return { error: "Бывшего клиента нельзя вернуть в «Потенциальный»", httpStatus: 400 }
  }

  // R2: «В Выбывшие» из ЧС/Архива — выводим из терминала (funnel→active_client),
  // право — владелец/управляющий (как возврат из ЧС/Архива).
  const churningFromTerminal =
    patchClientStatus === "churned" &&
    existing.clientStatus !== "churned" &&
    TERMINAL.includes(existing.funnelStatus)
  if (churningFromTerminal && role !== "owner" && role !== "manager") {
    return {
      error: "Только владелец или управляющий может вывести клиента из чёрного списка или архива",
      httpStatus: 403,
    }
  }
  const funnelStatusInject: "active_client" | null = churningFromTerminal ? "active_client" : null

  // Очистка clientStatus при переводе в воронковый бакет (Лид/Не целевой/Архив/ЧС),
  // если clientStatus не задан явно телом. active_client (инъекция) не бакет →
  // clientStatus=churned сохраняется.
  const effectiveFunnel = funnelStatusInject ?? patchFunnelStatus
  const clearClientStatus =
    !!effectiveFunnel && FUNNEL_BUCKETS.includes(effectiveFunnel) && patchClientStatus === undefined

  return { funnelStatusInject, clearClientStatus }
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `cd app && node --import tsx --test src/__tests__/former-client-status.test.ts`
Expected: PASS (11 тестов).

- [ ] **Step 5: Commit**

```bash
git -C /c/Users/Cyberjinn/Desktop/CRMKA add app/src/lib/clients/former-client-status.ts app/src/__tests__/former-client-status.test.ts
git -C /c/Users/Cyberjinn/Desktop/CRMKA commit -m "feat(clients): planFormerClientTransition — правила статусов бывшего клиента" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Опции селектора статуса `statusSelectorOptions`

**Files:**
- Create: `app/src/lib/clients/status-selector-options.ts`
- Test: `app/src/__tests__/status-selector-options.test.ts`

- [ ] **Step 1: Написать падающий тест**

`app/src/__tests__/status-selector-options.test.ts`:

```ts
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { statusSelectorOptions } from "../lib/clients/status-selector-options"

const values = (r: { options: { value: string }[] }) => r.options.map((o) => o.value)

describe("statusSelectorOptions", () => {
  it("никогда не клиент — режим funnel, есть Потенциальный", () => {
    const r = statusSelectorOptions({ isActiveClient: false, wasEverClient: false, clientStatus: null })
    assert.equal(r.mode, "funnel")
    assert.deepEqual(values(r), ["new", "potential", "non_target", "blacklisted", "archived"])
  })

  it("активный сейчас — режим transition: Выбывшие/Архив/ЧС", () => {
    const r = statusSelectorOptions({ isActiveClient: true, wasEverClient: true, clientStatus: "active" })
    assert.equal(r.mode, "transition")
    assert.deepEqual(values(r), ["churned", "archived", "blacklisted"])
  })

  it("активный по абонементу, но clientStatus=churned — есть Вернуть в Активные, нет повторных Выбывших", () => {
    const r = statusSelectorOptions({ isActiveClient: true, wasEverClient: true, clientStatus: "churned" })
    assert.equal(r.mode, "transition")
    assert.deepEqual(values(r), ["active", "archived", "blacklisted"])
  })

  it("бывший клиент, не активный, не churned — Выбывшие + Лид/Не целевой/ЧС/Архив, без Потенциального", () => {
    const r = statusSelectorOptions({ isActiveClient: false, wasEverClient: true, clientStatus: null })
    assert.equal(r.mode, "transition")
    assert.deepEqual(values(r), ["churned", "new", "non_target", "blacklisted", "archived"])
    assert.equal(values(r).includes("potential"), false)
  })

  it("бывший клиент, выбывший — Вернуть в Активные вместо Выбывших", () => {
    const r = statusSelectorOptions({ isActiveClient: false, wasEverClient: true, clientStatus: "churned" })
    assert.equal(r.mode, "transition")
    assert.deepEqual(values(r), ["active", "new", "non_target", "blacklisted", "archived"])
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd app && node --import tsx --test src/__tests__/status-selector-options.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализация**

`app/src/lib/clients/status-selector-options.ts`:

```ts
export type StatusOption = { value: string; label: string }
export type SelectorMode = "transition" | "funnel"

// Пресейл-воронка для тех, кто никогда не был клиентом.
const FUNNEL_OPTIONS: StatusOption[] = [
  { value: "new", label: "Лид" },
  { value: "potential", label: "Потенциальный" },
  { value: "non_target", label: "Не целевой" },
  { value: "blacklisted", label: "Чёрный список" },
  { value: "archived", label: "Архив" },
]

/**
 * Набор опций селектора статуса на карточке клиента.
 * - transition: значения active/churned роутятся в clientStatus, остальные — в funnelStatus.
 * - funnel: обычный селектор воронки (никогда не клиент).
 * Бывшему клиенту (wasEverClient) недоступен «Потенциальный», но доступны «В Выбывшие».
 */
export function statusSelectorOptions(p: {
  isActiveClient: boolean
  wasEverClient: boolean
  clientStatus: string | null
}): { mode: SelectorMode; options: StatusOption[] } {
  const churned = p.clientStatus === "churned"

  if (p.isActiveClient) {
    const head: StatusOption = churned
      ? { value: "active", label: "Вернуть в Активные" }
      : { value: "churned", label: "В Выбывшие" }
    return { mode: "transition", options: [head, { value: "archived", label: "В Архив" }, { value: "blacklisted", label: "В Чёрный список" }] }
  }

  if (p.wasEverClient) {
    const head: StatusOption = churned
      ? { value: "active", label: "Вернуть в Активные" }
      : { value: "churned", label: "В Выбывшие" }
    return {
      mode: "transition",
      options: [
        head,
        { value: "new", label: "Лид" },
        { value: "non_target", label: "Не целевой" },
        { value: "blacklisted", label: "Чёрный список" },
        { value: "archived", label: "Архив" },
      ],
    }
  }

  return { mode: "funnel", options: FUNNEL_OPTIONS }
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `cd app && node --import tsx --test src/__tests__/status-selector-options.test.ts`
Expected: PASS (5 тестов).

- [ ] **Step 5: Commit**

```bash
git -C /c/Users/Cyberjinn/Desktop/CRMKA add app/src/lib/clients/status-selector-options.ts app/src/__tests__/status-selector-options.test.ts
git -C /c/Users/Cyberjinn/Desktop/CRMKA commit -m "feat(clients): statusSelectorOptions — опции селектора статуса" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Подключить `planFormerClientTransition` в роут

**Files:**
- Modify: `app/src/app/api/clients/[id]/route.ts`

- [ ] **Step 1: Добавить импорт**

После строки `import { recordClientStatusChange } from "@/lib/clients/status-history"` добавить:

```ts
import { planFormerClientTransition } from "@/lib/clients/former-client-status"
```

- [ ] **Step 2: Вызвать план после проверки имени, до существующих гардов**

Найти блок (проверка имени):

```ts
  if (!hasName(resultFirstName) && !hasName(resultLastName)) {
    return NextResponse.json({ error: "Укажите фамилию или имя" }, { status: 400 })
  }
```

Сразу ПОСЛЕ него вставить:

```ts
  // Правила «бывшего клиента» (R1: запрет Потенциального; R2: вывод из ЧС/Архива
  // в Выбывшие + гейт роли; очистка clientStatus при переходе в воронковый бакет).
  const plan = planFormerClientTransition({
    existing,
    patchFunnelStatus: data.funnelStatus,
    patchClientStatus: data.clientStatus,
    role: session.user.role,
  })
  if ("error" in plan) {
    return NextResponse.json({ error: plan.error }, { status: plan.httpStatus })
  }
  const finalFunnelStatus = plan.funnelStatusInject ?? data.funnelStatus
```

- [ ] **Step 3: Заменить `movingToArchived` на решение плана**

Найти:

```ts
  // Если воронка переводится в archived/blacklisted — снимаем clientStatus,
  // чтобы устаревшая плашка («Выбывший» и т.п.) не висела на карточке.
  const movingToArchived =
    !!data.funnelStatus &&
    (data.funnelStatus === "archived" || data.funnelStatus === "blacklisted") &&
    data.clientStatus === undefined
```

Заменить на:

```ts
  // Снятие clientStatus при переводе в воронковый бакет — решает planFormerClientTransition
  // (archived/blacklisted как раньше + new/non_target для бывшего клиента).
  const clearClientStatus = plan.clearClientStatus
```

- [ ] **Step 4: Применить `finalFunnelStatus` и `clearClientStatus` в апдейте**

Найти в `tx.client.update({ data: { ... } })`:

```ts
        ...(data.funnelStatus && { funnelStatus: data.funnelStatus }),
        ...(movingToArchived
          ? { clientStatus: null }
          : data.clientStatus !== undefined && { clientStatus: data.clientStatus }),
```

Заменить на:

```ts
        ...(finalFunnelStatus && { funnelStatus: finalFunnelStatus }),
        ...(clearClientStatus
          ? { clientStatus: null }
          : data.clientStatus !== undefined && { clientStatus: data.clientStatus }),
```

- [ ] **Step 5: Типчек**

Run: `cd app && npx tsc --noEmit -p tsconfig.json`
Expected: EXIT 0.
(Если `finalFunnelStatus` не совпадает по типу с полем `funnelStatus` — привести: `finalFunnelStatus as typeof data.funnelStatus`. `"active_client"` — валидный `FunnelStatus`, каст обычно не нужен.)

- [ ] **Step 6: Commit**

```bash
git -C /c/Users/Cyberjinn/Desktop/CRMKA add "app/src/app/api/clients/[id]/route.ts"
git -C /c/Users/Cyberjinn/Desktop/CRMKA commit -m "feat(clients): применить правила бывшего клиента в PATCH /clients/[id]" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Подключить опции в `LeadStatusActions`

**Files:**
- Modify: `app/src/app/(dashboard)/crm/_components/lead-status-actions.tsx`

- [ ] **Step 1: Импорт и новый проп**

После существующих импортов (`@/components/ui/select`) добавить:

```ts
import { statusSelectorOptions } from "@/lib/clients/status-selector-options"
```

В сигнатуру `LeadStatusActions` добавить проп `wasEverClient`:

```ts
export function LeadStatusActions({
  clientId,
  currentStatus,
  clientStatus,
  isActiveClient = false,
  wasEverClient = false,
}: {
  clientId: string
  currentStatus: string
  clientStatus?: string | null
  isActiveClient?: boolean
  wasEverClient?: boolean
}) {
```

- [ ] **Step 2: Считать модель селектора и переписать рендер**

Внутри компонента, перед `return (`, добавить:

```ts
  const selector = statusSelectorOptions({
    isActiveClient,
    wasEverClient,
    clientStatus: clientStatus ?? null,
  })
```

Заменить весь `return (...)` (блок `<div className="flex flex-wrap items-center gap-2">…</div>`) на:

```tsx
  return (
    <div className="flex flex-wrap items-center gap-2">
      {selector.mode === "transition" ? (
        <Select value="" onValueChange={handleActiveTransition}>
          <SelectTrigger className="h-7 min-w-[170px] text-xs" disabled={statusLoading}>
            {currentBucketLabel}
          </SelectTrigger>
          <SelectContent>
            {selector.options.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Select value={statusValue} onValueChange={handleStatusChange}>
          <SelectTrigger className="h-7 min-w-[170px] text-xs" disabled={statusLoading}>
            {currentBucketLabel}
          </SelectTrigger>
          <SelectContent>
            {selector.options.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
```

- [ ] **Step 3: Удалить осиротевшие константы**

Удалить более не используемые `STATUS_OPTIONS` и `ACTIVE_TRANSITIONS` (их роль ушла в `statusSelectorOptions`). Оставить `STATUS_LABELS` (используется в `currentBucketLabel`).

- [ ] **Step 4: Типчек**

Run: `cd app && npx tsc --noEmit -p tsconfig.json`
Expected: EXIT 0. (Убедиться, что нет предупреждений про неиспользуемые `STATUS_OPTIONS`/`ACTIVE_TRANSITIONS` — они удалены.)

- [ ] **Step 5: Commit**

```bash
git -C /c/Users/Cyberjinn/Desktop/CRMKA add "app/src/app/(dashboard)/crm/_components/lead-status-actions.tsx"
git -C /c/Users/Cyberjinn/Desktop/CRMKA commit -m "feat(clients): селектор статуса использует statusSelectorOptions + проп wasEverClient" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Прокинуть `wasEverClient` из карточки

**Files:**
- Modify: `app/src/app/(dashboard)/crm/_components/client-card-content.tsx`

- [ ] **Step 1: Импорт предиката**

После строки `import { LeadStatusActions } from "./lead-status-actions"` добавить:

```ts
import { wasEverClient } from "@/lib/clients/was-ever-client"
```

- [ ] **Step 2: Передать проп**

Найти вызов (около строки 528):

```tsx
        <LeadStatusActions
          clientId={client.id}
          currentStatus={client.funnelStatus}
          clientStatus={client.clientStatus}
          isActiveClient={
            activeSubscriptions.length > 0 ||
            client.clientStatus === "active"
          }
        />
```

Заменить на (добавить проп `wasEverClient`):

```tsx
        <LeadStatusActions
          clientId={client.id}
          currentStatus={client.funnelStatus}
          clientStatus={client.clientStatus}
          isActiveClient={
            activeSubscriptions.length > 0 ||
            client.clientStatus === "active"
          }
          wasEverClient={wasEverClient({
            firstPaymentDate: client.firstPaymentDate,
            firstPaidLessonDate: client.firstPaidLessonDate,
            clientStatus: client.clientStatus,
          })}
        />
```

- [ ] **Step 3: Типчек**

Run: `cd app && npx tsc --noEmit -p tsconfig.json`
Expected: EXIT 0. (Поля `client.firstPaymentDate` / `client.firstPaidLessonDate` / `client.clientStatus` доступны — клиент грузится через `include` без `select`, т.е. все скаляры возвращаются.)

- [ ] **Step 4: Commit**

```bash
git -C /c/Users/Cyberjinn/Desktop/CRMKA add "app/src/app/(dashboard)/crm/_components/client-card-content.tsx"
git -C /c/Users/Cyberjinn/Desktop/CRMKA commit -m "feat(clients): карточка передаёт wasEverClient в селектор статуса" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Полная проверка

**Files:** —

- [ ] **Step 1: Прогнать все юнит-тесты новых модулей**

Run:
```
cd app && node --import tsx --test src/__tests__/was-ever-client.test.ts src/__tests__/former-client-status.test.ts src/__tests__/status-selector-options.test.ts
```
Expected: все PASS (5 + 11 + 5 = 21).

- [ ] **Step 2: Полный типчек проекта**

Run: `cd app && npx tsc --noEmit -p tsconfig.json`
Expected: EXIT 0.

- [ ] **Step 3: Ручной чек-лист (после деплоя на msk1)**

На клиенте `fb7d302f-806b-4ed9-b363-1914fba23f15` (орг «Школа студия Class»):
- Селектор статуса показывает «В Выбывшие», НЕ показывает «Потенциальный».
- Занести в ЧС → в ЧС в селекторе есть «В Выбывшие»; под владельцем/управляющим клик уводит в «Выбывшие» (вкладка «Выбывшие»), под админом — 403.
- Попытка перевести в «Потенциальный» (если где-то остался пункт/прямой вызов) → 400.
- Никогда-не-клиент (свежий лид) — селектор прежний, «Потенциальный» доступен.

- [ ] **Step 4: Деплой (по решению владельца)**

Push в main → автодеплой (Timeweb/Hetzner). Проверить CI: `gh run list --repo denshimansky/crmka --limit 3`. Дождаться success.

---

## Self-Review

**Spec coverage:**
- Предикат «бывший клиент» → Task 1. ✔
- Правило 1 (запрет Потенциального) → Task 2 (логика) + Task 4 (подключение). ✔
- Правило 2 (Выбывшие из ЧС/Архива + гейт роли + инъекция active_client) → Task 2 + Task 4. ✔
- Очистка clientStatus при переводе в воронковый бакет → Task 2 + Task 4 (шаги 3–4). ✔
- UI: три ветки селектора, «В Выбывшие» для бывшего, без «Потенциального» → Task 3 + Task 5. ✔
- Прокидка wasEverClient → Task 6. ✔
- Тесты (предикат, гарды, селектор) → Tasks 1–3. ✔

**Placeholder scan:** плейсхолдеров нет; весь код приведён.

**Type consistency:** `wasEverClient(...)` — единая сигнатура (Tasks 1, 6); `planFormerClientTransition` возвращает `{ error, httpStatus } | { funnelStatusInject, clearClientStatus }`, роут читает `plan.funnelStatusInject`/`plan.clearClientStatus` (Task 4); `statusSelectorOptions` возвращает `{ mode, options }`, компонент читает `selector.mode`/`selector.options` (Task 5). Согласовано.
