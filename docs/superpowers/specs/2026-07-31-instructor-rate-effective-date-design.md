# Ставка педагога с датой вступления в силу

- **Дата:** 2026-07-31
- **Статус:** дизайн на согласовании
- **Тип:** фича (ЗП инструкторов)
- **Аналог:** баг #88 «Стоимость направления с датой вступления»
  (`2026-07-30-direction-price-effective-date-design.md`)

## Проблема

Центр меняет ставку ЗП педагога с определённой даты (пример: с 1 сентября у
инструктора ставка за занятие 700 → 800 ₽). Владелец/управляющий должен задать
новую ставку **с указанием даты старта** в карточке ставки сотрудника. Занятия
**с этой даты и позже** считаются по новой ставке, занятия **до неё** — по старой,
независимо от того, когда их отметили.

Сейчас у ставки нет временно́го измерения: правка `SalaryRate` перезаписывает её
мгновенно и глобально. Задать ставку «с сентября», не трогая августовские занятия,
невозможно.

## Ключевое отличие от цены направления (обосновывает архитектуру)

Цена направления садится **слепком в `Subscription`** при выписке и больше не
перечитывается, поэтому для неё работает связка «промоутер (перенос будущей версии
в базу) + резолвер в 3 точках создания абонемента».

Ставка педагога устроена иначе:

1. Считается **по дате занятия** (`Lesson.date`), а не по дате создания чего-либо.
2. **Пересчитывается на лету** при любой мутации отметок:
   `reallocateLessonPay` заново зовёт `resolveRate` для всего занятия.
3. Занятия часто отмечают **задним числом**.

Из-за (2) и (3) «точная копия» механики цены (промоутер перезаписывает базовую
ставку) даёт реальную дыру: августовское занятие, отмеченное или **переотмеченное**
в сентябре, посчиталось бы по **новой** ставке — молча изменив уже начисленную
(возможно, выплаченную) ЗП. У цены этой проблемы нет by design, у ЗП — есть.

## Правило выбора ставки (одобрено пользователем)

Ставка резолвится **по дате занятия** из истории версий. Модель хранит **все**
версии (и прошлые, и будущие); занятие всегда считается по ставке своего периода —
даже если отметить/переотметить его задним числом после смены ставки. **Промоутер
не нужен** — резолвер по дате закрывает и прошлое, и будущее.

- ставка «с 01.09» = 800; базовая (до) = 700;
- занятие 20.08 → 700 (нет версии `effectiveFrom <= 20.08`);
- занятие 05.09, отмеченное хоть 20.08, хоть 10.09 → 800.

## Охват (одобрено пользователем)

**Только личные ставки** — `SalaryRate` с `directionId = null` (дефолтная) и с
`directionId = uuid` (исключение по направлению). **Ставка группы**
(`GroupSalaryRate`) меняется как сейчас — мгновенно, без версий.

## Микро-решения (одобрено пользователем)

1. `effectiveFrom` новой версии — **строго в будущем** (как у цены). Правка
   «текущей/базовой» ставки = мгновенная (семантика `SalaryRate` не меняется).
2. Брекеты плавающей матрицы версии — **3-й nullable FK** в существующей
   `SalaryBracket`, а не отдельная таблица.
3. **Impact-счётчик** — включаем (число будущих занятий инструктора, которые
   пересчитаются по новой ставке).

## Текущее состояние (по коду)

- **`SalaryRate`** (`app/prisma/schema.prisma:709-732`): одна запись на пару
  `employeeId + directionId`. Поля: `scheme` (`per_student | per_lesson |
  fixed_plus_per_student | percent_of_payments | floating_by_students`),
  `ratePerStudent?`, `ratePerLesson?`, `fixedPerShift?`, `percentOfPayments?`,
  `trialPayMode` (`none | paid_only | all`), брекеты через `SalaryBracket`. Правка
  перезаписывает на месте — истории нет.
- **`GroupSalaryRate`** (`schema.prisma:737-754`) — ставка группы, перекрывает
  личные. **Вне scope** этой фичи.
- **`SalaryBracket`** (`schema.prisma:758-773`) — полиморфна: `salaryRateId?` |
  `groupSalaryRateId?` (ровно один FK). Строка плавающей матрицы «N учеников →
  ставка за занятие».
- **Резолвер** `lib/salary/resolve-rate.ts`:
  - `resolveRate(db, { tenantId, groupId, employeeId, directionId })` — приоритет:
    **1)** `GroupSalaryRate` группы → **2)** личная по направлению → **3)** личная
    дефолтная → `null`. Дата занятия **не участвует**.
  - `resolveTrialPayMode(db, { tenantId, employeeId, directionId })` — режим оплаты
    пробного из личной ставки (по направлению → дефолт → `"none"`). Тоже без даты.
- **Потребители `resolveRate` (все per-lesson, у всех есть дата занятия):**
  1. `api/lessons/[id]/attendance/route.ts:513` (одиночная отметка) и `:1065`
     (bulk) — `resolveRate`; `:292` и `:1075` — `resolveTrialPayMode`. Есть
     `lesson` с `date`, `groupId`, `group.directionId`,
     `instructorId`/`substituteInstructorId`.
  2. `lib/salary/reallocate-lesson-pay.ts:157` — `resolveRate`; уже грузит
     `lesson.date`.
  3. `lib/services/trial-lesson.ts` и `api/trial-lessons/[id]/route.ts` —
     `resolveRate`/`resolveTrialPayMode` для пробного занятия (есть дата пробного).
  4. `lib/salary/forecast-month.ts:143` — **своя** inline-версия `resolveRate`
     (батч-резолв по map без даты). Прогноз ЗП на месяц; у каждого занятия есть
     `l.date`.
- **`calcPay`** (`lib/salary/calc-pay.ts`) и `computePayTargets`
  (`reallocate-lesson-pay.ts`) получают **уже разрешённую** `ResolvedRate` — их
  менять не нужно.
- **CRUD ставок:**
  - `POST /api/employees/[id]/salary-rates` — создать личную ставку
    (`route.ts`, роль owner/manager, дедуп по `employee+direction`).
  - `PATCH/DELETE /api/salary-rates/[id]` — правка (полное переписывание матрицы) /
    удаление.
  - Валидация: `lib/salary/rate-schema.ts` — `baseRateSchema`, `validateForScheme`
    (матрица брекетов обязана начинаться с 1 ребёнка, без дублей порогов).
- **UI ставки:** `components/salary/salary-rate-form.tsx`; страница ЗП сотрудника
  (карточка сотрудника → раздел ставок).
- **Прод-примечание:** RLS на проде не enforced — все запросы строго
  `where: { tenantId }`, владение по id (memory `project_no_rls_app_layer_tenant`).

## Архитектура

Одна часть (без крон-промоутера): **резолвер по дате занятия над историей версий.**

`SalaryRate` остаётся **базовой/генезис**-ставкой (действует «с начала времён» до
первой запланированной версии). Правка базовой ставки — мгновенная, как сейчас
(влияет на все занятия, не покрытые версией, — это уже текущее поведение
пересчёта). Запланированные и прошедшие изменения лежат отдельными строками
`SalaryRateSchedule` (полный снимок ставочного блока + `effectiveFrom`).

`resolveRate` получает `atDate` и внутри выбранной **личной** identity накладывает
версию по дате: среди неудалённых `SalaryRateSchedule` этой identity с
`effectiveFrom <= atDate` берёт с максимальным `effectiveFrom`; если таких нет —
базовый `SalaryRate`. Приоритет group → exception → default **сохраняется**:
identity выбирается по наличию базовой строки (как сейчас), затем внутри неё —
резолв по дате.

Единая точка правды выбора версии — чистая функция `pickRateAt` в отдельном файле
(юнит-тесты без БД, по образцу `promote-direction-prices-plan.ts`). Сравнение —
строго по UTC-дню (`dayNumUtc` / `toUtcDay`, переиспользуем из
`lib/subscriptions/direction-price.ts`).

**Промоутер не нужен**, поэтому дыры «ретро-граница», как у цены направления, здесь
нет: занятие 20.08 всегда резолвится к базе (или августовской версии), когда бы его
ни отметили.

## Изменения

### 1. Данные (Prisma-миграция, аддитивно)

- Новая модель `SalaryRateSchedule` (снимок ставочного блока на дату):
  ```prisma
  model SalaryRateSchedule {
    id                String       @id @default(uuid()) @db.Uuid
    tenantId          String       @map("tenant_id") @db.Uuid
    employeeId        String       @map("employee_id") @db.Uuid
    directionId       String?      @map("direction_id") @db.Uuid
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

    employee  Employee        @relation(fields: [employeeId], references: [id], onDelete: Cascade)
    direction Direction?      @relation(fields: [directionId], references: [id])
    brackets  SalaryBracket[]

    @@index([tenantId, employeeId, directionId, effectiveFrom])
    @@map("salary_rate_schedules")
  }
  ```
- В `SalaryBracket` — 3-й nullable FK:
  ```prisma
  salaryRateScheduleId String?             @map("salary_rate_schedule_id") @db.Uuid
  salaryRateSchedule   SalaryRateSchedule? @relation(fields: [salaryRateScheduleId], references: [id], onDelete: Cascade)
  @@index([tenantId, salaryRateScheduleId])
  ```
- Back-relations: `Employee.salaryRateSchedules`, `Direction.salaryRateSchedules`.
- Семантика: `SalaryRateSchedule` — изменения ставки с датой (на момент создания
  `effectiveFrom > сегодня`). Прошлые версии остаются в таблице как история и
  участвуют в резолве по дате. Базовый `SalaryRate` = ставка до первой версии.
- **Прод-миграция без бэкфилла:** у существующих `SalaryRate` нет schedule-строк →
  резолвер для всех прошлых занятий падает на базу = поведение 1:1 с текущим.

### 2. Резолвер + unit-тесты (TDD)

- `lib/salary/pick-rate-at.ts` — чистая функция:
  ```ts
  pickRateAt(base, schedules, atDate): RateSnapshot
  // среди неудалённых версий с effectiveFrom <= atDate берём max effectiveFrom;
  // если таких нет — base. Сравнение по dayNumUtc.
  ```
  `RateSnapshot` = поля ставки + `brackets` (нормализованные, как в `ResolvedRate`).
- `resolve-rate.ts`:
  - `resolveRate(db, input, atDate)` — новый обязательный `atDate`. Для личных
    ветвей грузим `brackets` **и** `salaryRateSchedules` (с их брекетами) для
    identity, прогоняем через `pickRateAt(atDate)`. Групповая ветвь — без изменений.
  - `resolveTrialPayMode(db, input, atDate)` — `trialPayMode` из снимка по дате.
- Тесты `pickRateAt`: до/на/после границы; несколько версий (ближайшая слева);
  пустой список → base; удалённые игнорируются; брекеты берутся из выбранной версии;
  UTC-границы дня.

### 3. Точки потребления (проброс даты занятия)

Дата резолва — фактическая дата занятия `Lesson.date` (ЗП считается по факту
проведения; `rescheduledFromDate` — только для состава, memory
`feedback_roster_from_subscription` / комментарий в схеме `Lesson`).

- `attendance/route.ts` — `resolveRate(..., lesson.date)` в `:513` и `:1065`;
  `resolveTrialPayMode(..., lesson.date)` в `:292` и `:1075`.
- `reallocate-lesson-pay.ts` — `resolveRate(tx, {...}, new Date(lesson.date))`.
- `trial-lesson.ts` / `trial-lessons/[id]/route.ts` — прокинуть дату пробного.
- `forecast-month.ts` — сделать date-aware: догрузить `salaryRateSchedules` для
  `instructorIds`, заменить inline-`resolveRate(groupId, employeeId, directionId)`
  на резолв по `l.date` (для каждого занятия своя действующая версия). Групповая
  ставка — без версий. Прогноз будущего месяца сразу видит запланированную ставку.

### 4. API версий ставки

`[id]` = id базовой `SalaryRate`. Роль owner/manager (как остальной CRUD ставок),
все запросы `where: { tenantId }`, владение проверяем по `SalaryRate` → `employee`.

- `GET /api/salary-rates/[id]/schedule` — список будущих версий (можно и все,
  для истории; UI фильтрует).
- `POST /api/salary-rates/[id]/schedule` — создать версию: полный снимок
  (`baseRateSchema` + `validateForScheme`) + `effectiveFrom` **строго в будущем**;
  брекеты пишем с `salaryRateScheduleId`. Наследует identity (`employeeId`,
  `directionId`) от базовой ставки.
- `PATCH/DELETE /api/salary-rates/[id]/schedule/[scheduleId]` — правка (полное
  переписывание матрицы, как в `salary-rates/[id]`) / soft delete (`deletedAt`).
- `GET /api/salary-rates/[id]/schedule/impact?from=YYYY-MM-DD` — счётчик будущих
  занятий инструктора, которые пересчитаются:
  ```
  lesson.count({ where: { tenantId, date: { gte: from },
    status: { in: ["scheduled", "completed"] }, isTrial: false,
    OR: [{ instructorId: empId }, { substituteInstructorId: empId }],
    // для исключения по направлению — group.directionId = directionId
  } })
  ```
  Приблизительный (не учитывает перекрытие групповой ставкой) — как ориентир.

### 5. UI — планирование ставки + предупреждение

- `components/salary/salary-rate-form.tsx` (или обёртка карточки ставки): под каждой
  личной ставкой — секция **«Запланированные изменения ставки»** (аналог
  «Запланированные изменения цены» у направления):
  - список будущих версий (дата + краткая сводка схемы/ставки), кнопки
    «изменить»/«удалить»;
  - «Запланировать изменение с даты»: подформа, поля **преднаполнены текущими**
    значениями ставки (оператор меняет нужное), выбор даты (строго будущая) —
    переиспользуем существующий редактор схем/матрицы;
  - при валидной дате — фетч `.../schedule/impact?from=` и **баннер**: «Уже
    проведённые занятия пересчитываются по ставке своего периода. С DD.MM новая
    ставка затронет ≈ N будущих занятий инструктора.»;
  - подсказка **«Сейчас действует: …»**, если прошедшая версия перекрывает базу
    (так как промоутера нет, базовая строка может быть не равна текущей действующей).
- Групповая ставка — секцию версий **не** показываем (вне scope).

### 6. Правила проекта

- **PageHelp:** обновить ключ страницы ЗП сотрудника в
  `app/src/lib/page-help-content.ts` (описать планирование ставки с датой,
  предупреждение, что занятия считаются по ставке своего периода).
- **Тесты:**
  - unit `pickRateAt` (см. п.2);
  - unit `resolveRate(atDate)` — версия по дате перекрывает базу; групповая ставка
    по-прежнему перекрывает личную с версией;
  - `POST .../schedule` — валидация (будущая дата, схема);
  - `impact` — корректный счётчик;
  - интеграция: смена ставки с 01.09 → отметка занятия 20.08 (старая) и 05.09
    (новая); ретро-отметка занятия 20.08, сделанная в сентябре → **старая** ставка;
    прогноз ЗП на сентябрь (в августе) → новая ставка.

## Вне scope

- Версионирование `GroupSalaryRate` (ставка группы — мгновенная, как сейчас).
- Прогноз `percent_of_payments` (как сейчас — 0).
- Массовое изменение ставок нескольким инструкторам одной операцией.
- Отчёт по истории ставок педагогов.

## Риски

- **Проброс `atDate` по всем потребителям `resolveRate`:** сигнатура становится
  обязательной — компилятор поймает все 5 точек; убедиться, что нигде не передаётся
  «сегодня» вместо даты занятия (иначе ретро-пересчёт снова сломается).
- **`forecast-month.ts`:** оптимизирован под батч; переписать резолв на per-lesson
  по дате, сохранив производительность (предзагрузка версий одним запросом).
- **Прод-миграция на msk1:** аддитивная (новая таблица + nullable FK) — безопасна;
  известны DNS/build-quirks (`build.network: host`) — memory
  `project_msk1_deploy_timeout`.
- **Мультитенантность/RLS:** RLS не enforced — все запросы строго
  `where: { tenantId }`, владение версии проверять по базовой `SalaryRate` →
  `employeeId` (memory `project_no_rls_app_layer_tenant`).
- **Гонка READ COMMITTED** при параллельных мутациях одного занятия — существующее
  ограничение `reallocateLessonPay`, версии его не усугубляют (резолв детерминирован
  по дате).
