# Баг #88 — Стоимость направления с датой вступления в силу

- **Дата:** 2026-07-30
- **Статус:** дизайн на согласовании
- **Тип:** фича (ценообразование направлений)

## Проблема

Центр повышает стоимость части направлений с определённой даты (пример: с
1 сентября дорожают 3 направления из 10). Сотрудник должен задать новую цену
занятия **с указанием даты старта** в карточке направления. Абонементы,
выписываемые под эту дату и позже (в т.ч. августовская выписка на сентябрь),
считаются уже по новой ставке; **ранее созданные абонементы не пересчитываются**.
При сохранении новой цены — **явное предупреждение** об этом.

Сейчас у направления одна цена без временно́го измерения (`Direction.lessonPrice`),
и правка перезаписывает её мгновенно и глобально для всех будущих выписок. Задать
цену «с сентября», не трогая августовские выписки, невозможно.

## Правило выбора ставки (одобрено пользователем)

Ставка выбирается **по дате старта абонемента (`Subscription.startDate`)**, а не по
дате выписки/создания:

- новая цена задана «с 01.09»;
- абонемент выписан 15.08, старт 01.09 → **новая** ставка;
- абонемент выписан 15.08, старт 25.08 → **старая** ставка.

Дата создания абонемента ни на что не влияет.

## Решения (одобрено пользователем)

1. **Датируются все четыре цены направления:** цена занятия (`lessonPrice`),
   пакетные цены (`packagePrices`), пробное (`trialPrice`/`trialFree`), разовое
   (`singleVisitPrice`). Версия цены = полный снимок прайс-блока на дату.
2. **История версий:** можно заранее запланировать несколько будущих изменений
   (по образцу `GroupScheduleTemplate.effectiveFrom`), не только одно.
3. **Предупреждение + счётчик:** при сохранении новой цены показываем текст «уже
   созданные абонементы не пересчитываются» **и** число уже выписанных абонементов
   будущего периода по прежней цене, которые останутся без изменений.

## Текущее состояние (по коду)

- **`Direction`** (`app/prisma/schema.prisma:442-474`): `lessonPrice Decimal(12,2)`
  (обяз.), `trialPrice?`, `trialFree`, `singleVisitPrice?`, `packagePrices Json?`
  (#89), `lessonDuration`. **Нет** даты вступления в силу и истории — правка
  перезаписывает цену на месте.
- **`Subscription`**: снимает слепок цены при создании (`lessonPrice`, `totalAmount`,
  `finalAmount`, `balance`) и **никогда не перечитывает направление**. То есть
  «не пересчитывать уже созданные» — это уже поведение по умолчанию; отдельной
  защиты существующих абонементов не требуется.
- **3 точки создания абонемента** (единственные `subscription.create` в коде):
  1. **Массовая выписка** — `lib/subscriptions/bulk-renew.ts:323` берёт
     `s.direction.lessonPrice` (комментарий: «цена выписки = актуальный прайс
     направления»); период/старт = `opts.rangeStart` (1 сентября), `bulk-renew.ts:364-365,413`.
     Только `type:"calendar"`.
  2. **Конвертация заявки** — `app/src/app/api/wards/[id]/move-to-awaiting-payment/route.ts`:
     календарь `route.ts:269` = `direction.lessonPrice`; пакет `route.ts:206-214` =
     `packageLessonPrice(...)`. Старт = `firstPaidLessonDate` (`route.ts:221-222`).
  3. **Ручное создание** — `POST /api/subscriptions` (`route.ts:243,271`): `lessonPrice`
     приходит **из тела запроса** (форма подставляет на клиенте), сервер направление
     не перечитывает. `startDate` = переданная либо 1-е число периода (`route.ts:248-252`).
     Через этот роут идут ручная выписка, `quick-renew-subscription-dialog`, `renew-button`.
- **Другие потребители цен направления** (читают `direction.*` напрямую, по дате
  события — их менять не нужно, см. «Промоутер»):
  - Разовое посещение: `api/lessons/[id]/attendance/route.ts:771,1275` —
    `direction.singleVisitPrice ?? direction.lessonPrice`, списание в момент отметки.
  - Пробное: `lib/services/trial-lesson.ts:314-318` — `trialPrice`/`trialFree`.
  - Отчёты/ЗП/скидки: множество мест читают `direction.lessonPrice` как «текущую цену».
- **Редактор направления:** страница `settings/directions/page.tsx`, форма
  `settings/edit-direction-dialog.tsx` (+ `create-direction-dialog.tsx`), API
  `api/directions/[id]/route.ts` (PATCH, роль owner/manager) и `api/directions/route.ts`.
- **Крон-инфраструктура** уже есть (7 воркфлоу через секрет `CRON_URL` → msk1).

## Архитектура

Две части — минимально инвазивно к деньгам:

### 1. Промоутер (крон) — держит базовую цену «живой»

`Direction.*` базовые поля остаются **текущей действующей ценой** (правка = мгновенно,
как сейчас). Будущие изменения хранятся отдельно; ежедневный крон переносит
наступившую версию в базовые поля направления и гасит версию. Благодаря этому
**все существующие потребители** (разовое, пробное, отчёты, ЗП, скидки, формы)
автоматически берут новую цену с даты вступления — **без изменений в их коде**.

### 2. Резолвер «выписки вперёд» — только 3 точки создания

Единственная причина, по которой недостаточно одного промоутера: абонемент на
сентябрь выписывается в августе, **до** того как крон промоутит цену. Поэтому 3
точки создания абонемента (и только они) резолвят цену по `startDate` абонемента,
заглядывая в **запланированные будущие версии**.

Единая точка правды — новый хелпер `lib/subscriptions/direction-price.ts`:

```ts
directionPriceAt(base, pendingVersions, atDate): ResolvedPrices
// среди версий с effectiveFrom <= atDate берём с максимальным effectiveFrom;
// если таких нет — базовые поля направления.
```

- Календарь: `directionPriceAt(direction, versions, startDate).lessonPrice`.
- Пакет: `packageLessonPrice(directionPriceAt(direction, versions, startDate), templateId)`
  (композиция с уже существующим хелпером #89 — сначала выбор версии по дате, затем
  пер-пакетный оверрайд из снимка версии).

Крайний случай (зарядка будущего разового/пробного до промоутинга, или ретро-создание
абонемента задним числом через границу цены) — базовая цена; вне scope, как и в #89.

## Изменения

### 1. Данные (Prisma-миграция, аддитивно)

- Новая модель `DirectionPrice` (полный снимок прайса на дату):
  ```prisma
  model DirectionPrice {
    id               String    @id @default(uuid()) @db.Uuid
    tenantId         String    @map("tenant_id") @db.Uuid
    directionId      String    @map("direction_id") @db.Uuid
    effectiveFrom    DateTime  @map("effective_from") @db.Date
    lessonPrice      Decimal   @map("lesson_price") @db.Decimal(12, 2)
    trialPrice       Decimal?  @map("trial_price") @db.Decimal(12, 2)
    trialFree        Boolean   @default(false) @map("trial_free")
    singleVisitPrice Decimal?  @map("single_visit_price") @db.Decimal(12, 2)
    packagePrices    Json?     @map("package_prices")
    createdAt        DateTime  @default(now()) @map("created_at")
    createdBy        String?   @map("created_by") @db.Uuid
    appliedAt        DateTime? @map("applied_at")   // промоутер проставляет при переносе в базу
    deletedAt        DateTime? @map("deleted_at")
    direction        Direction @relation(fields: [directionId], references: [id])
    @@index([tenantId, directionId, effectiveFrom])
    @@map("direction_prices")
  }
  ```
- В `Direction` — back-relation `directionPrices DirectionPrice[]`.
- Семантика: строки `DirectionPrice` — **только будущие** запланированные изменения
  (`effectiveFrom > сегодня` на момент создания). Базовые поля `Direction` = живая цена.

### 2. Резолвер + unit-тесты (TDD)

`lib/subscriptions/direction-price.ts` — `directionPriceAt(base, versions, atDate)`.
Мирроринг стиля `package-price.ts` (единственная точка правды). Тесты: до/на/после
границы; несколько версий (берётся ближайшая слева); пустой список → база;
`appliedAt`/`deletedAt` игнорируются; композиция с `packageLessonPrice`.

### 3. Промоутер (крон)

- `lib/subscriptions/promote-direction-prices.ts` — переносит версии с
  `effectiveFrom <= сегодня`, `appliedAt IS NULL`, `deletedAt IS NULL` в базовые
  поля их направления (перезапись прайс-блока), ставит `appliedAt = now()`. Идемпотентно.
  Аудит-запись «цена направления обновлена по расписанию» (`employee_id = NULL` = «Система»).
- Роут `app/src/app/api/cron/promote-direction-prices/route.ts` (guard как у прочих
  кронов) + новый GitHub Actions воркфлоу (ежедневно, через `CRON_URL`). Смотреть
  memory `project_cron_url_points_msk1`, `project_msk1_deploy_timeout`.

### 4. Точки создания абонемента (резолвер по дате старта)

- **bulk-renew.ts:** предзагрузить будущие версии направлений (одним запросом по
  `directionId in [...]`), в `previewBulkRenew` заменить `s.direction.lessonPrice`
  на `directionPriceAt(s.direction, versionsMap[s.directionId], opts.rangeStart).lessonPrice`.
- **move-to-awaiting-payment/route.ts:** загрузить версии направления; календарь →
  `directionPriceAt(...).lessonPrice` по `firstPaid`; пакет → `packageLessonPrice(directionPriceAt(...), tpl.id)`.
- **POST /api/subscriptions:** сделать сервер источником истины базовой цены —
  подгрузить направление + версии, вычислить `startDate` (как сейчас) и взять
  `directionPriceAt(...)`; календарь → `.lessonPrice`, пакет → `packageLessonPrice(...)`.
  Тело запроса на базовую цену больше не полагается (проверить, что форма не даёт
  оператору ручной ввод произвольной цены — по #89 ручная скидка убрана, цена = цена
  направления).

### 5. API версий цены направления

- `GET /api/directions/[id]/prices` — список будущих версий.
- `POST /api/directions/[id]/prices` — создать версию (полный снимок + `effectiveFrom`;
  валидация: дата строго в будущем, цены ≥ 0, ключи пакетов как в #89). Роль owner/manager.
- `PATCH/DELETE /api/directions/[id]/prices/[priceId]` — правка/удаление
  запланированной версии (soft delete).
- `GET /api/directions/[id]/prices/impact?from=YYYY-MM-DD` — счётчик уже выписанных
  абонементов будущего периода по прежней цене:
  ```
  subscription.count({ where: { tenantId, directionId, deletedAt: null,
    status: { in: ["pending", "active"] }, startDate: { gte: from } } })
  ```

### 6. Форма направления — планирование цены + предупреждение

- `edit-direction-dialog.tsx` (+ по паритету `create-direction-dialog.tsx`):
  - Секция «Запланированные изменения цены»: список будущих версий (дата + прайс)
    с кнопками «изменить»/«удалить».
  - «Запланировать изменение с даты»: подформа, прайс-поля **преднаполнены текущими**
    значениями (оператор меняет нужное), выбор даты (строго будущая).
  - При валидной дате — фетч `.../prices/impact?from=` и **баннер-предупреждение**:
    «Уже созданные абонементы не пересчитываются. На период с DD.MM уже выписано N
    абонементов по прежней цене — они останутся без изменений.» Сохранение — через
    подтверждение.
- Если в карточке правится **текущая** цена, а будущая версия уже запланирована —
  версия видна в списке (оператор понимает, что она позже перезапишет базу). MVP:
  не авто-синхроним; edge-case задокументирован.

### 7. Правила проекта

- **PageHelp:** обновить `settings/directions` в `app/src/lib/page-help-content.ts`
  (описать планирование цены с датой и предупреждение).
- **Тесты (unit/integration):**
  - `directionPriceAt` (см. п.2).
  - Промоутер: версия с прошедшей датой → перенос в базу + `appliedAt`; будущая — не трогается.
  - `POST /api/directions/[id]/prices` — валидация (будущая дата, цены ≥ 0).
  - `impact` — корректный счётчик.
  - Конвертация/выписка: сентябрьский старт → новая цена; августовский → старая.

## Вне scope

- Пересчёт уже созданных абонементов (по требованию — не пересчитываем).
- Ретро-создание абонемента задним числом через границу цены и зарядка будущего
  разового/пробного до промоутинга — берут базовую цену (edge-case).
- Датирование прочих настроек направления (длительность, цвет, иконка).
- Отчёты по истории цен направлений.

## Риски

- **Прод-миграция на msk1:** аддитивная (новая таблица + nullable) — безопасна;
  известны DNS/build-quirks (`build.network: host`) — memory `project_msk1_deploy_timeout`.
- **Новый крон:** промоутер мутирует `Direction.lessonPrice` без участия человека —
  делаем идемпотентным + аудит-лог; подключить к `CRON_URL` (memory `project_cron_url_points_msk1`).
  Альтернатива без крона (ленивый промоутинг на чтении/записи) — отвергнута как хрупкая.
- **POST /api/subscriptions становится источником истины цены:** убедиться, что ни
  один клиент/форма не рассчитывает на ручной ввод произвольной базовой цены.
- **Мультитенантность/RLS:** на проде RLS не enforced — все запросы строго с
  `where: { tenantId }`, владение версии проверять по направлению (memory
  `project_no_rls_app_layer_tenant`).
