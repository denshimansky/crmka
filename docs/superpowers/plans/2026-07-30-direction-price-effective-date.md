# Стоимость направления с датой вступления в силу (баг #88) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development или superpowers:executing-plans. Шаги — чекбоксы (`- [ ]`).

**Goal:** Дать задавать новую цену направления **с датой старта**; абонементы со
`startDate >= даты` считаются по новой ставке (в т.ч. августовская выписка на
сентябрь), уже созданные не пересчитываются; при сохранении — предупреждение +
счётчик затронутых будущих абонементов.

**Architecture:** База `Direction.*` = живая цена (правка мгновенна). Будущие
изменения — строки `DirectionPrice` (полный снимок прайса + `effectiveFrom`).
Ежедневный крон-промоутер переносит наступившую версию в базу направления → все
существующие потребители берут новую цену без правок в их коде. Резолвер
`directionPriceAt()` нужен только в 3 точках создания абонемента (выписка вперёд).

**Spec:** `docs/superpowers/specs/2026-07-30-direction-price-effective-date-design.md`

**Сравнение дат:** только по календарному дню в UTC (`dayNumUtc`), чтобы граница
даты не плыла от таймзоны сервера. Все `effectiveFrom` сохраняются как UTC-полночь.

---

### Task 1: Схема + миграция

- Modify: `app/prisma/schema.prisma` (Direction ~442-474)
- Create: миграция `direction_price_versions`

- [ ] **Step 1:** Добавить модель `DirectionPrice` (см. спеку, раздел «Данные») и
  back-relation `directionPrices DirectionPrice[]` в `Direction`.
- [ ] **Step 2:** `cd app && npx prisma migrate dev --name direction_price_versions --create-only`; проверить SQL (CREATE TABLE `direction_prices` + FK + индекс). Аддитивно.
- [ ] **Step 3:** `npx prisma migrate dev && npx prisma generate`.
- [ ] **Step 4:** commit `feat(db): DirectionPrice — версии цены направления (#88)`.

---

### Task 2: Резолвер `directionPriceAt` + unit-тесты (TDD)

- Create: `app/src/lib/subscriptions/direction-price.ts`, `app/src/__tests__/direction-price.test.ts`

- [ ] **Step 1 (тест сначала):** до/на/после границы; несколько версий (ближайшая слева); пусто → база; `appliedAt`/`deletedAt` игнор; композиция с `packageLessonPrice`; TZ-стабильность (`dayNumUtc`).
- [ ] **Step 2:** реализовать `directionPriceAt(base, versions, atDate): ResolvedDirectionPrice` (`{ lessonPrice, trialPrice, trialFree, singleVisitPrice, packagePrices }`) + `dayNumUtc(date)`.
- [ ] **Step 3:** `node --import tsx --test src/__tests__/direction-price.test.ts` — зелено.
- [ ] **Step 4:** commit `feat(subscriptions): directionPriceAt resolver (#88)`.

---

### Task 3: Промоутер + unit-тест

- Create: `app/src/lib/cron/promote-direction-prices.ts`, тест `app/src/__tests__/promote-direction-prices.test.ts` (чистая функция выбора «что промоутить» — вынести `pickDuePrices(versions, now)`).

- [ ] **Step 1:** `pickDuePrices` (due = `effectiveFrom <= сегодня` по `dayNumUtc`, `appliedAt=null`, `deletedAt=null`; на направление берётся ближайшая к сегодня, промежуточные тоже помечаются applied) + тест.
- [ ] **Step 2:** `promoteDirectionPrices(now?)`: транзакция на направление — перенос снимка в `Direction.*` (packagePrices через `Prisma.JsonNull` при null), пометка версий `appliedAt`, аудит-лог `employee_id=NULL`. Идемпотентно.
- [ ] **Step 3:** commit `feat(cron): промоутер цен направлений (#88)`.

---

### Task 4: Крон-роут + workflow

- Create: `app/src/app/api/cron/promote-direction-prices/route.ts` (guard Bearer `CRON_SECRET`, по образцу close-finished-calendar-subscriptions), `.github/workflows/promote-direction-prices.yml` (`cron: '0 0 * * *'`, дергает `CRON_URL`).

- [ ] commit `feat(cron): роут+workflow промоутинга цен (#88)`.

---

### Task 5: API версий цены направления

- Create: `app/src/app/api/directions/[id]/prices/route.ts` (GET список будущих, POST создать), `app/src/app/api/directions/[id]/prices/[priceId]/route.ts` (PATCH/DELETE), `app/src/app/api/directions/[id]/prices/impact/route.ts` (GET `?from=`).

- [ ] **Step 1:** GET — будущие непромоутнутые версии направления (по `tenantId` + владение направлением). POST — zod (дата строго в будущем; `lessonPrice>=0`; `packagePrices` как в directions API); хранить UTC-полночь.
- [ ] **Step 2:** PATCH/DELETE (soft) конкретной версии с проверкой владения.
- [ ] **Step 3:** impact — `subscription.count({ tenantId, directionId, deletedAt:null, status:{in:[pending,active]}, startDate:{ gte: fromUtc } })`.
- [ ] **Step 4:** роль owner/manager везде; `npx tsc --noEmit`.
- [ ] **Step 5:** commit `feat(directions): API версий цены + impact (#88)`.

---

### Task 6: Интеграция в 3 точки создания

- Modify: `app/src/lib/subscriptions/bulk-renew.ts`, `app/src/app/api/wards/[id]/move-to-awaiting-payment/route.ts`, `app/src/app/api/subscriptions/route.ts`

- [ ] **bulk-renew:** предзагрузить будущие версии по `directionId in [...]`; `price = directionPriceAt(s.direction, versions[dirId], rangeStart).lessonPrice`.
- [ ] **move-to-awaiting:** загрузить версии направления; календарь `directionPriceAt(...).lessonPrice` по `firstPaid`; пакет `packageLessonPrice(directionPriceAt(...), tpl.id)`.
- [ ] **POST /api/subscriptions:** подгрузить направление(+версии), резолвить по `startDate`; сервер — источник истины базовой цены (тело для базовой цены больше не авторитетно). Пакет — через `packageLessonPrice(resolved, tplId)`.
- [ ] `npx tsc --noEmit`; commit `feat(subscriptions): цена по дате старта в точках выписки (#88)`.

---

### Task 7: Форма направления — планирование + предупреждение

- Modify: `app/src/app/(dashboard)/settings/edit-direction-dialog.tsx`, `settings/directions/page.tsx` (проброс `id`), при необходимости `create-direction-dialog.tsx`

- [ ] **Step 1:** Секция «Запланированные изменения цены»: `GET .../prices` при открытии, список версий (дата+прайс) с «изменить»/«удалить».
- [ ] **Step 2:** Подформа «Запланировать изменение с даты»: поля преднаполнены текущими значениями; дата строго будущая; при валидной дате — `GET .../prices/impact` и баннер-предупреждение со счётчиком; submit → POST версии, затем подтверждение.
- [ ] **Step 3:** `npx tsc --noEmit`; commit `feat(directions): планирование цены с датой + предупреждение (#88)`.

---

### Task 8: PageHelp

- Modify: `app/src/lib/page-help-content.ts` (ключ `settings/directions`).
- [ ] commit `docs(help): справка по датированным ценам направлений (#88)`.

---

### Task 9: Верификация + деплой

- [ ] `cd app && npx tsc --noEmit` — чисто.
- [ ] `cd app && npm run test:unit` — новые зелёные, без регрессий.
- [ ] Ручной прогон: запланировать цену с даты → выписать на будущий период (новая цена) → на текущий (старая) → предупреждение со счётчиком.
- [ ] `git push origin main`; `gh run list --repo denshimansky/crmka --limit 3`; дождаться деплоя; прод-миграция через `prisma migrate deploy`.

---

## Self-Review

- **Покрытие спеки:** данные (T1), резолвер (T2), промоутер+крон (T3–T4), API+impact (T5), 3 точки создания (T6), форма+предупреждение (T7), PageHelp (T8), тесты (T2,T3,T9).
- **Риски:** прод-миграция аддитивна; новый крон идемпотентен + аудит; TZ — сравнение по `dayNumUtc`; POST становится источником истины цены (проверить отсутствие ручного ввода произвольной цены).
