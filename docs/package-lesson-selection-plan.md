# План: пакетные абонементы с явным выбором занятий

> **Статус:** финализирован после состязательного аудита (48 агентов, 33 подтверждённых замечания).
> **Дата:** 06.08.2026
> **Решения владельца:** (1) отметку вне выбора **блокировать** (не drop-in); (2) при отмене выбранного занятия — **освободить слот + задача**; (3) объём — **полный** (включая правку/swap с откатом).

## Контекст (зачем)

Частый запрос: группа даёт, условно, 8 занятий в период, а клиент покупает пакет на 4 и хочет заранее
проставить **конкретные** дни, в которые придёт. Цели:
1. Клиент виден и списывается **только** на выбранных занятиях; на невыбранных его нет ни в составе, ни в посещениях.
2. По-занятийная вместимость — «не продать больше, чем группа вмещает на конкретное занятие».
3. Отчёты остаются корректными.

Модель «дни недели» (`GroupEnrollment.selectedDays`) для этого не годится: пакет = **N визитов со сроком годности**,
а не еженедельное обязательство, и «какие 4 из 5 понедельников» она не выражает. Поэтому — явный выбор
конкретных экземпляров `Lesson`.

---

## ГЛАВНОЕ: сохранность существующих данных при миграции

**Уже отмеченные занятия и существующие абонементы НЕ пострадают.** Аудит: `migrationHarms: []`.
Гарантируется тремя механизмами:

1. **Миграция аддитивная** — только `CREATE TABLE subscription_lessons` + FK + индексы + RLS. Никаких
   `ALTER`/`NOT NULL`/`UPDATE`-бэкфиллов по `lessons`/`subscriptions`/`attendance`. Обратные relation-поля
   Prisma колонок не создают. → **обязателен ревью сгенерированного `migration.sql`.**
2. **Уже проставленные `Attendance` показываются мимо гейта покрытия** (карточка занятия рисует отмеченных
   через `oneTimeAttendances`/`lesson.attendances` независимо от coverage — `schedule/lessons/[id]/page.tsx:507-510`,
   `roster-filter.ts:85-88`). Новый гейт скрыть/удалить существующую отметку не может.
3. **Легаси-фолбэк** (см. Инвариант №1): пакет без строк выбора = поведение 1:1 как сегодня.

**Единственный способ всё сломать** (находка уровня `data-loss`, но предотвратимая): вычислять `hasSelection`
**на уровне тенанта/фиче-флага**, а не по факту наличия строк у конкретного абонемента. Тогда сотни живых
пакетов «Умного Я» (таблица пуста после миграции) разом потеряют покрытие → ученики исчезнут из состава, а
перемётка уведёт визит в разовое `personal_lesson_charge` с баланса родителя = **двойное списание** за уже
оплаченное пакетом занятие. Инвариант №1 это исключает.

---

## Модель данных

Новая таблица (образец SQL — миграция `20260620130000_add_lesson_student_notes`: RLS + `bypass_rls` + grant `app_user`):

```prisma
model SubscriptionLesson {
  id             String   @id @default(uuid()) @db.Uuid
  tenantId       String   @map("tenant_id") @db.Uuid
  subscriptionId String   @map("subscription_id") @db.Uuid
  lessonId       String   @map("lesson_id") @db.Uuid
  createdBy      String?  @map("created_by") @db.Uuid
  createdAt      DateTime @default(now()) @map("created_at")

  subscription Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  lesson       Lesson       @relation(fields: [lessonId], references: [id], onDelete: Cascade)

  @@unique([subscriptionId, lessonId])
  @@index([tenantId, lessonId])   // по-занятийный count вместимости/счётчика
  @@map("subscription_lessons")
}
```
- Только `subscriptionId` (без денорм `wardId/clientId`) — членство резолвится join'ом через `subscription.wardId`
  (см. Инвариант №3 и guard C-23).
- `ON DELETE CASCADE` на `lessonId` — массовая отмена физически удаляет `Lesson` (нужен снапшот ДО удаления, см. L-15).
- Бэкфилла нет — легаси-пакеты остаются без строк.

---

## Три инварианта (нарушение любого = регрессия)

**№1 — Легаси-фолбэк пер-абонементный.** `hasSelection(sub) = COUNT(subscription_lessons WHERE subscriptionId=sub.id) > 0`.
Определять **строго по факту строк у ЭТОГО абонемента**, никогда по `org.subscriptionType`/флагу. Нет строк →
старое правило `packageLessonsRemaining(totalLessons, consumed) > 0` во **всех пяти точках**: `subscriptionCoversDate`,
`coverageKeysOnDate`, `buildCoverageResolver`, POST-FIFO в attendance route, `pickChargeableSubscription`.
Тест: пакет без строк = состав/списание/сетка идентичны до-фичевым.

**№2 — «Израсходовано/остаток» всегда по `Attendance`.** `SubscriptionLesson` влияет **только** на покрытие/право
отметки/вместимость, но **никогда** на `remaining`. Кроны `close-expired-packages`/`notify-expiring-packages`
не трогать. Тест: пакет с выбором и без — `remaining` одинаков при равном числе списывающих отметок.

**№3 — wardId не теряем.** Членство = `SubscriptionLesson.lessonId = L AND subscription.wardId = rosterWard`.
Тест: два ребёнка одного клиента в одной группе, разный выбор — гейт не путает.

---

## Изменения по компонентам

### 1. Резолвер покрытия — `lib/subscriptions/roster-filter.ts` + новый `lib/subscriptions/subscription-lessons.ts`

Новый модуль: `loadPackageSelections(db, tenantId, subIds) → { byLesson: Map<subId,Set<lessonId>>, hasSelection: Set<subId> }`
и единый предикат `packageSelectionGate(sel, subId, lessonId)` (легаси → true; explicit → членство).

- **Не перегружать** 5-й аргумент `excludeLessonId` под селекцию (его роль — исключение урока из `consumed`,
  семантика противоположна). Добавить **отдельный обязательный** параметр `lessonId` в `isCoveredOn(...)` —
  чтобы TypeScript **провалил все 4 внешних вызова** и они были осознанно обновлены (guard **B-5**).
- `buildCoverageResolver` дополнительно батч-грузит `Map<subId,Set<lessonId>>` по пакетам диапазона.
- **Видимость ≠ списание** (guard **C-10**): lesson-aware гейт применяется к **плановой (неотмеченной) ячейке**
  сетки/«Неотмеченных»/«Пропусков», к **счётчику** и к **списанию**. Показ в **карточке занятия** зачисленного
  пакетника оставить (бейдж «не в плане»), чтобы оператор его видел; отметка всё равно блокируется на mark-time.

### 2. Блокировка списания вне плана — `lib/subscriptions/package-remaining.ts` + `api/lessons/[id]/attendance/route.ts`

Решение владельца №1 = **ошибка, а не drop-in**. Ключевые guard'ы:

- **B-6 / C-7:** одиночный POST резолвит пакет **инлайном** (`route.ts:448-485`), а bulk — через
  `pickChargeableSubscription` (`package-remaining.ts:68-80`); **оба не резолвер-based**, смену сигнатуры
  резолвера компилятор здесь не поймает. Гейт `packageSelectionGate` вставить **явно в обе ветки**.
- **C-8:** ввести независимый признак `hasLivePackageOnGroup(client, ward, group/direction, date)` (active/pending,
  не истёк, remaining>0). Три исхода: выбрано → списать; **есть живой пакет + не выбрано → 403 «занятие не входит
  в пакет, измените план»**; пакета нет / `remaining=0` → **существующая** разовая ветка (легитимный drop-in).
  Блок **нельзя** выводить из «резолв не удался» (иначе заблокируем законные разовые и исчерпанные пакеты).
- **C-7:** блок ставить **ДО** ветки «No subscription — разовое» (`route.ts:731-853` single, `1254-1373` bulk).
- **C-9:** гейт обязательно за `!isMakeupArrival && !lesson.isTrial` — отработка (Ф7) списывает со слота
  **исходного** L1, целевое L2 в выбор не входит по построению; иначе сломаем отработки.
- **C-11:** блок держать на **mark-time** (POST/PUT), **не** на `add-student` (это общий вход для разовых/гостей/
  добавления на отработку). Портал read-only (роутов отметки нет) — вне периметра.

### 3. Создание — `api/subscriptions/route.ts` + `api/wards/[id]/move-to-awaiting-payment/route.ts`

Единый валидатор в `subscription-lessons.ts`, идентично в обоих путях (guard **F-18/F-25**):
- `new Set(ids).size === ids.length` (без дублей); `ids.length === totalLessons`;
- все `lessonId` принадлежат `groupId`/направлению абонемента, `tenantId` совпал, `status !== 'cancelled'`;
- `effectiveRosterDate(lesson)` в `[startDate .. expiresAt]` включительно. **Прошлые `scheduled/completed`
  занятия НЕ отбрасывать** (guard **F-20**: back-dated старт поддержан осознанно — `ensure-enrollment.ts:96-99`).
- **F-21:** в POST при `packageTemplateId` форсить/валидировать `totalLessons = tpl.lessonsCount` (сейчас POST
  берёт `totalLessons` из тела, move — из шаблона; пути расходятся).
- **F-22 (кросс-пакет):** `@@unique([subscriptionId,lessonId])` НЕ запрещает один урок в **двух** живых пакетах
  одного подопечного (дедуп-guard #52 — только для calendar). Отклонять `lessonId`, уже входящий в другой живой
  пакет того же `(clientId,wardId,groupId)`, под тем же локом.
- **F-19 (горизонт EAGER):** перед выбором считать **реальные** строки
  `db.lesson.count({ groupId, status in [scheduled,completed], date in [startDate..expiresAt] })`. Если `< totalLessons`
  → 400 с текстом «в сроке пакета у группы только N из M занятий — продлите срок/сдвиньте старт/сгенерируйте
  расписание (группа работает до DD.MM)». (Крона догенерации нет — `getGenerationRange` = `endDate ?? +1 год`.)
- **F-24 (порядок tx):** `subscription.create → createMany(SubscriptionLesson) → ensureEnrollmentForSubscription
  → recalcClientDiscounts`. Всё в одной `$transaction`; откат атомарен.
- **F-25:** для `org=package && totalLessons>0` требовать `selectedLessonIds` в обоих путях (в т.ч. конвертация
  заявки из воронки, где `Application.packageTemplateId`), чтобы после релиза не плодить «плавающие» пакеты
  мимо решения №1. Мягкий API-путь — только для легаси/миграции.

### 4. Вместимость по-занятийно (guard D-12/D-13/D-14)

- Ёмкость занятия = `Group.maxStudents`. «Занято» = **дедуплицированное объединение** по `(clientId,wardId)`:
  выборы `SubscriptionLesson` ∪ **легаси-покрытые пакеты** (remaining>0, на каждом занятии окна) ∪ пробные
  (`TrialLesson.lessonId`) ∪ отработки (`isMakeup`/`scheduledMakeupLessonId`) ∪ разовые placeholder. Union
  автоматически снимает mixed-mode-проблему (легаси считается на каждом занятии, как enrollment; выбор — только
  на выбранных). Считать только `SubscriptionLesson` — **нельзя** (недосчёт → oversell).
- Гонка: `pg_advisory_xact_lock(hashtext(lessonId))` в транзакции создания/swap (проверить прецеденты
  `$executeRaw` advisory в репо; иначе Serializable + retry).

### 5. Счётчик «N/max» в сетке — `schedule/page.tsx` (guard A-4 / coverage-9 / D)

Сейчас = `group._count.enrollments (isActive)` — одно число на группу для всех занятий (`:217-218`, `:409-415`).
Для package-тенанта: один `groupBy(SubscriptionLesson.lessonId)` по видимым занятиям + **дедупнутое** объединение
с `extraAttendeesByLesson` (пробные/отработки — не терять, фикс #50) и легаси-покрытыми пакетами.
**Фолбэк на старый `_count.enrollments` при отсутствии строк** (легаси-пакет иначе даст «0/max»).
Календарные тенанты и `schedule-filters.tsx`/`month-calendar-view.tsx` — без изменений (форма данных та же).

### 6. Отчёты

- **«Неотмеченные»** + **«Пропуски»** + **сетка «Посещения»**: протянуть `lesson.id` в `isCoveredOn` (4 вызова,
  `lessonId` у каждого уже в scope — guard **B-5**). Существующий `selectedDays`-фильтр независим (AND), не трогать.
- **6.2 «Прогноз сдельной ЗП»** (`lib/salary/forecast-month.ts`): `studentsCount` на занятие для package-тенанта
  считать по `groupBy(SubscriptionLesson.lessonId)` (для `per_student`/`floating`), фолбэк на `enrollCount` для
  легаси/календарных. Влияет и на дашборд «Прогноз прибыли» — прогноз снизится и станет ближе к факту (осознанно).
- Остальные (4.1, 4.2, 5.1, 5.2, 5.3, 5.9, 5.10, 7.1, 7.3) — читают хранимые поля абонемента / факт `Attendance`
  → **корректны сами собой** (при соблюдении Инварианта №2).

### 7. Жизненный цикл

- **L-15 (отмена/удаление занятия — решение №2):** ДО `deleteMany` (`reconcile-calendar-day.ts:106-109`) и в
  одиночном `DELETE /api/lessons/[id]` (`route.ts:762`) снять **снапшот** `SubscriptionLesson WHERE lessonId IN
  deletableIds` (после cascade их не найти). По снапшоту: освободить слот + создать **новый** тип задачи
  `reselect_package_lesson` (`createMissedMakeupTask` жёстко заточен под `missed_makeup` — переиспользовать нельзя).
  `recalcSubscriptionsOnScheduleChange` пакеты игнорирует (`:107`) — `totalLessons` не трогаем (Инвариант №2).
- **L-16 (swap — решение №3):** вынести revert одной отметки (реверс `lesson_refund` + `decrement chargedAmount`
  + откат разового `personal_lesson_charge` + `repriceSubscription`) в **общий хелпер** — сейчас логика инлайн
  дублируется 3× (`lessons/[id]/route.ts:527-608`, `attendance/route.ts:604-730`, bulk `~1176-1253`); 4-я
  рукописная копия = риск двойного списания/фантомного возврата. Swap с зачищающими отметками запрещать при
  `isPeriodLocked(старая дата)` для не-владельца/управляющего (симметрично переносу).
- **L-17 (перенос за `expiresAt`):** выбор следует за `lessonId` (устойчив к переносу). Но покрытие/списание идут
  по замороженной `effectiveRosterDate` → занятие физически за сроком всё равно покрыто. **Решение (рекоменд.):**
  срок мягкий (дата продажи важнее фактической), как и текущий дизайн `rescheduledFromDate` — задокументировать.
  Альтернатива (жёсткий срок): при переносе за `expiresAt` снимать `SubscriptionLesson` + задача.

### 8. UI — форма выбора

Новый переиспользуемый `crm/_components/package-lesson-picker.tsx`, встраивается в обе формы:
`AddSubscriptionDialog` (`client-tabs.tsx`, package-ветка ~1889-1949) и `awaiting-payment-dialog.tsx`.
- Endpoint: расширить `/api/groups/[id]/lessons` параметром `to` (= `expiresAt`), добавить эффективного инструктора
  и `isPast`; поднять `take` (365 дн × 5/нед ≈ 260).
- UX: группировка по месяцам (окно ~38 занятий на 90д/3× в неделю, до ~260 на год); **липкий счётчик «выбрано X/N»**;
  submit заблокирован пока `X≠N`; предзаполнялка по дням недели («по понедельникам» + «первые N подряд») с мягким
  капом (overshoot → красный счётчик); прошлые занятия с бейджем «прошло», кликабельны; баннер «в окне только M<N —
  продлите срок/расписание».

### 9. PageHelp (`lib/page-help-content.ts`)

Обновить ключи: `schedule` (счётчик N/max), `schedule/lessons/[id]` (состав/бейдж «не в плане»),
`crm/clients/[id]` (шаг выбора занятий), `reports/attendance/unmarked` (учёт выбора).

---

## Порядок внедрения (инкрементально, каждый шаг деплоится сам по себе)

1. **Миграция + Prisma-модель** — аддитивно, поведение не меняется.
2. **Read-слой**: `subscription-lessons.ts` + lesson-aware резолвер с пер-абонементным фолбэком + проброс
   обязательного `lessonId` в 4 потребителя. Пока строк нет — поведение идентично (безопасно).
3. **Создание** (обе формы + валидатор + вместимость + `createMany`) — с этого шага новые пакеты получают выбор.
4. **Блокировка списания** (POST-FIFO + bulk + `hasLivePackageOnGroup`, за `!makeup && !trial`).
5. **Счётчик сетки + прогноз 6.2** (union-подсчёт с фолбэком).
6. **Жизненный цикл**: снапшот+задача при отмене, swap с общим revert-хелпером, правило переноса за срок.

---

## Чек-лист подтверждённых guard'ов (из аудита)

| ID | Guard | Severity |
|---|---|---|
| **№1** | Легаси-фолбэк пер-абонементный (COUNT строк у sub), не org-level | data-loss (предотвр.) |
| A-2 | Миграция только `CREATE TABLE`, ревью SQL, отметки не скрывать | spec |
| №2 | remaining всегда по Attendance; кроны не трогать | spec |
| B-5 | `lessonId` **обязателен** в `isCoveredOn` → TS валит 4 вызова | spec |
| B-6/C-7 | Гейт явно в POST-FIFO и в `pickChargeableSubscription` (не резолвер-based) | correctness |
| C-7 | Вне плана → 403, **не** drop-in | correctness |
| C-8 | Различать «нет пакета» vs «есть, но не выбрано» через `hasLivePackageOnGroup` | spec |
| C-9 | Гейт за `!isMakeupArrival && !lesson.isTrial` (не сломать Ф7) | correctness |
| C-10 | Видимость в карточке ≠ списание (бейдж «не в плане») | spec |
| C-11 | Блок на mark-time, не на add-student; портал вне периметра | ux |
| D-12 | Вместимость = union источников, дедуп по (clientId,wardId) | spec |
| D-14 | advisory-lock от гонки oversell | spec |
| L-15 | Снапшот SubscriptionLesson ДО deleteMany + задача reselect | correctness |
| L-16 | Общий revert-хелпер для swap + гейт закрытого периода | spec |
| L-17 | Правило переноса за expiresAt (реком.: мягкий срок) | spec |
| F-18/25 | Валидатор выбора идентичен в обоих путях; выбор обязателен для package | spec |
| F-19 | Проверка реального числа занятий в окне (горизонт EAGER) | ux |
| F-20 | НЕ вводить «не в прошлом» (back-dated старт) | spec |
| F-21 | POST: `totalLessons = tpl.lessonsCount` | spec |
| F-22 | Один урок не в два живых пакета подопечного | correctness |
| A-4/D-13 | Счётчик/вместимость: фолбэк на старый подсчёт для легаси | ux |
| №3 | Членство через `subscription.wardId` (join) | correctness |

---

## Верификация (перед мержем)

- **Регресс-тест Инварианта №1**: создать пакет без строк → состав занятия, «Отметить всех», списание, сетка,
  «Неотмеченные» идентичны до-фичевым (snapshot до/после на демо-базе).
- **Тест Инварианта №2**: пакет с выбором и без — `remaining`/закрытие крона одинаковы при равных списаниях.
- **Блокировка**: отметка на невыбранном занятии (grid, add-student, «Отметить всех», API) → 403; на выбранном →
  списание с пакета; исчерпанный пакет/нет пакета → разовое; отработка Ф7 → проходит.
- **Вместимость**: 15 выбравших + пробник + отработка на maxStudents=15 → oversell не проходит.
- **Жизненный цикл**: отмена выбранного дня → слот освобождён + задача; swap отмеченного занятия → корректный
  откат без двойного списания (проверить `chargedAmount` и баланс родителя до/после).
- **Данные msk1**: read-only проверка, что у существующих пакетов «Умного Я» после деплоя шага 2 состав/списание
  не изменились (пер-абонементный фолбэк).

## Открытые микро-решения (уточнить при реализации)

- **C-10:** прятать невыбранного пакетника из планового ростера (чище) **или** показывать с бейджем «не в плане»
  (по букве решения №1). Рекоменд.: прятать из планового состава + блок при явном add-student.
- **L-17:** мягкий срок (реком.) vs жёсткий (снимать выбор при переносе за `expiresAt`).
