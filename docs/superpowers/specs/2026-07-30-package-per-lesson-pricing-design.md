# Баг #89 — Цена занятия по пакетам (пакетное ценообразование)

- **Дата:** 2026-07-30
- **Статус:** дизайн одобрен, готов к плану реализации
- **Тип:** фича (пакетный тип абонементов)

## Проблема

Пакетный тип абонементов. Сейчас у направления одна цена занятия
(`Direction.lessonPrice`), и она тянется в пакетный абонемент независимо от
размера пакета. Нужно задавать цену занятия **отдельно для каждого пакета**
(шаблона пакета) в рамках направления. При выписке абонемента и при создании
заявки — выбор пакета должен автоматически подставлять пакетную цену занятия,
итоговую стоимость абонемента и срок завершения.

## Текущее состояние (по коду)

- **`Direction`** (`app/prisma/schema.prisma`): единый `lessonPrice` (Decimal),
  плюс `singleVisitPrice`, `trialPrice`, `lessonDuration`. Пер-пакетной цены нет.
- **`PackageTemplate`** (орг-уровень): `lessonsCount`, `validDays?`, `isActive`,
  `sortOrder` — **без цены**. Настраивается в `/settings/subscription-model`
  (`package-templates-content.tsx`). Только для `subscriptionType==="package"`.
- **`Subscription`**: `type`, `lessonPrice`, `totalLessons`, `totalAmount`,
  `finalAmount`, `balance`, `startDate`, `expiresAt`, `packageTemplateId` (уже есть).
  Пакетный `expiresAt = startDate + validDays` **уже считается** при создании.
- **Ручная выписка** (`AddSubscriptionDialog` в `crm/clients/[id]/client-tabs.tsx`):
  селектор пакета **уже есть** — ставит `totalLessons` + `validDays`, но **НЕ цену**.
  Цена = `lessonPrice × totalLessons`, `lessonPrice` тянется из `direction.lessonPrice`,
  редактируема. Предпросмотр «Истекает» уже есть.
- **`Application`** (заявка): хранит `clientId/wardId/branchId/directionId/stage/comment`.
  **НЕТ** `groupId`, `totalLessons`, `lessonPrice`, `packageTemplateId`. Создаётся
  одним диалогом `create-application-dialog.tsx` (поля: клиент/подопечный/филиал/
  направление/комментарий), переиспользуемым во всех точках (Продажи, карточка
  клиента, контакты «+», из обзвона).
- **Конвертация** `move-to-awaiting-payment/route.ts` (единственный путь заявка →
  абонемент): **ЖЁСТКО `type:"calendar"`**, `totalLessons` из месячного подсчёта
  занятий группы, `lessonPrice` из `direction.lessonPrice`, ставит period. Пакетной
  ветки нет — сейчас воронка пакетных орг фактически создаёт календарные абонементы.
- Ветка по `org.subscriptionType` реализована только в ручном
  `POST /api/subscriptions` (`route.ts:176-278`).

## Решения (одобрено пользователем)

1. **Модель цены:** базовая цена направления **+ необязательные переопределения по
   пакетам**. Пакет без своей цены → базовая. Ничего не ломается для существующих
   направлений и не-пакетных орг.
2. **Хранение переопределений:** JSON на направлении (вариант А) — без новой таблицы.
3. **Пер-пакетная цена — это цена ЗАНЯТИЯ** (per-lesson). Итог = цена × `lessonsCount`.
4. **Пакет в заявке:** выбирается при создании заявки (сохраняется), при конвертации
   редактируем (дефолт из заявки), для пакетных орг **обязателен при конвертации**.

## Изменения

### 1. Данные (Prisma-миграция)

- `Direction.packagePrices Json?` — карта переопределений `{ packageTemplateId: number }`
  (только заданные; отсутствие ключа → базовая цена).
- `Application.packageTemplateId String? @db.Uuid` + relation → `PackageTemplate`
  `onDelete: SetNull`.
- Новый хелпер `lib/subscriptions/package-price.ts`:
  `packageLessonPrice(direction, templateId?): number =`
  `direction.packagePrices?.[templateId] ?? Number(direction.lessonPrice)`.
  Единственная точка правды для цены пакетного занятия.

### 2. Направление — цены по пакетам

- `create-direction-dialog.tsx` и `edit-direction-dialog.tsx`: при
  `org.subscriptionType === "package"` — секция «Цены по пакетам»: строка на каждый
  активный `PackageTemplate` («4 занятия», «8 занятий»…), поле «Цена занятия»,
  плейсхолдер = базовая цена (пусто = базовая). Диалоги начинают грузить
  `/api/organization` и `/api/package-templates`.
- `POST /api/directions` и `PATCH /api/directions/[id]`: zod + сохранение
  `packagePrices`. Валидация: ключи — существующие активные `templateId` тенанта;
  значения ≥ 0; пустые значения опускаются (не записываются).
- Обновить типы `CreatedDirection` / `DirectionData` и `settings/directions/page.tsx`
  (передача `packagePrices` в форму правки).

### 3. Ручная выписка (`AddSubscriptionDialog`)

- В `DirectionOption` добавить `packagePrices`.
- При выборе пакета (в дополнение к уже существующему авто-`totalLessons`+`validDays`):
  `lessonPrice = packageLessonPrice(direction, templateId)`. Итог `= цена × занятий`
  пересчитывается сам, срок `expiresAt` уже авто. Цена остаётся редактируемой.

### 4. Заявка — создание

- `create-application-dialog.tsx`: для пакетных орг — селектор пакета (сетка кнопок:
  занятий + срок), показ пакетной цены направления. **Необязателен** (можно выбрать
  при конвертации). Диалог начинает грузить `/api/organization` + `/api/package-templates`.
- `POST /api/applications`: zod += `packageTemplateId?`; сохранение на `Application`.
- Точки рендера диалога не меняются (моды прежние).

### 5. Конвертация заявка → абонемент (достроить пакетный путь)

- `awaiting-payment-dialog.tsx`: для пакетных орг — селектор пакета (**обязателен**,
  дефолт = `application.packageTemplateId`), поля срок/дата старта + предпросмотр
  «Истекает» (как в ручной выписке). Группа и дата старта по-прежнему выбираются
  (для зачисления). payload += `packageTemplateId`, `validDays`. Грузит org+templates.
- `move-to-awaiting-payment/route.ts`: ветка по `org.subscriptionType` (зеркало
  `subscriptions/route.ts`). Для `package`: `type:"package"`, `periodYear/Month:null`,
  `totalLessons = template.lessonsCount` (не месячный подсчёт по группе),
  `lessonPrice = packageLessonPrice(direction, templateId)`,
  `validDays = выбранный ?? template.validDays ?? org.packageDefaultValidDays`,
  `expiresAt = startDate + validDays`, проброс `packageTemplateId`. Календарная ветка
  без изменений. Валидация: пакетная орг требует `packageTemplateId`.

### 6. Фолбэки / крайние случаи

- Старые направления и не-пакетные орг: `packagePrices=null` → всё по-старому.
- Пакет без переопределения → базовая цена.
- Удалён/добавлен шаблон → ключи-сироты в `packagePrices` игнорируются; новый шаблон
  без цены → базовая.
- Заявка без пакета (старая/не выбрали) → пакет обязательно выбирается при конвертации.
- `bulk-renew` несёт сохранённую цену абонемента — не трогаем.
- Скидки v2 (`recalcClientDiscounts`) применяются после — совместимо (работают от
  `lessonPrice`).

### 7. Правила проекта

- **PageHelp**: обновить тексты страниц направлений, выписки, заявки/ожидаем оплату
  (`app/src/lib/page-help-content.ts`).
- **Тесты (unit):**
  - `packageLessonPrice`: override / fallback на базовую / ключ-сирота.
  - `POST`/`PATCH` `/api/directions` с `packagePrices` (валидация ключей/значений).
  - Конвертация пакетной заявки → package-абонемент (тип, цена, `totalLessons`,
    `expiresAt`, `packageTemplateId`).
  - `POST /api/applications` с `packageTemplateId`.

## Вне scope

- Пер-пакетное ценообразование в `bulk-renew` (несёт сохранённую цену абонемента).
- Отчёты по пер-пакетным ценам.
- Ретро-изменение уже созданных абонементов.

## Риски

- **Prisma-миграция на проде (msk1):** известны DNS/build-quirks
  (`build.network: host`, ручной обход при таймауте). Миграция аддитивная (nullable
  колонки) — безопасна.
- Существующее расхождение предпросмотра «Истекает» (local-time в UI vs UTC на сервере)
  — не в scope, не трогаем.
