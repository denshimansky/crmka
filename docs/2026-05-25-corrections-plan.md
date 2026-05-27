# План корректировок CRMka (v1.5.6 → v1.6)

## Прогресс

- ✅ **Ф1 — Матрица посещений и базовые модели** — задеплоено на dev 2026-05-25, коммит `153087b`.
  - Миграция `20260525120000_extend_attendance_type` применена (поля: availableToInstructor, partOfPlan, partOfFact, partOfForecast, chargePercent).
  - Seed добавил недостающие системные строки `no_show` (Не был) и `excused` (Уваж. пропуск).
  - CRUD API `/api/attendance-types` + страница `settings/attendance-matrix` со встроенной матрицей и модалкой создания.
  - Пользовательские дубли («Присутствие», «Неуваж. пропуск», «Болезнь», «Пробное» и т.п.) данные не трогали — Анна сама деактивирует через `isActive=false` в UI.
- ⏳ **Ф2 — Финансовая логика** — на очереди.
- ⏳ Ф3 — Ставки педагогов.
- ⏳ Ф4 — Занятия (карточка).
- ⏳ Ф5 — CRM (клиенты, дети, абонементы, история).
- ⏳ Ф6 — Права, видимость, задачи.

## Контекст

Анна формирует пакет требований по итогам опытной эксплуатации. Запрос затрагивает 6 подсистем: ставки педагогов, занятия и посещения, балансы клиентов, реестр детей, права/видимость, настройки задач. Часть требований переписывает базовые финансовые инварианты (модель баланса), часть добавляет настраиваемость поверх существующих сущностей (матрица AttendanceType, GroupRate). Цель — закрыть всё одним набором согласованных миграций, без промежуточных «полу-состояний» в финансовых данных.

Ниже — фазированный план. Фазы упорядочены так, чтобы каждая следующая опиралась на уже стабилизированный фундамент и чтобы ни одна миграция не оставила систему в неконсистентном виде. Внутри фаз ссылки — на конкретные файлы и места в коде, которые трогаем.

---

## Сводка ответов пользователя (фиксирую как контракт)

- **Баланс**: две метрики. `Client.clientBalance` — деньги (могут уйти в минус), `Subscription.balance` — занятия (не уходит в минус). Выписка абонемента списывает полную стоимость с денежного баланса. Посещение — с абонемента. УП с возвратом — возвращает на денежный баланс. Отработка — списывается с абонемента (не возвращается). Персональное занятие — с денежного баланса.
- **Кнопка «Добавить ученика» на занятии**: оператор в модалке выбирает источник (абонемент или баланс родителя).
- **Перенос даты/времени занятия**: без отметок — админ/управляющий/владелец; с отметками — только управляющий/владелец, модалка предупреждения, сброс отметок + откат списаний и ЗП, запись в журнал аудита.
- **История в карточке ребёнка**: только относящееся к ребёнку (пробные/абонементы/посещения/статусы/задачи по этому ребёнку). Коммуникации и оплаты родителя — НЕ показываем.
- **Матрица посещений**: 6 строк (Был, Не был, УП, Прогул, Перерасчёт, Отработка), 6 столбцов (доступно педагогу, План, Факт, Прогноз, Расчёт, Начисление ЗП). Настраивает владелец в settings.
- **«Активный» ребёнок**: вычисляемое — есть active subscription или enrollment в группе.
- **Видимость телефонов**: глобальный флаг организации «скрывать у инструктора» + запрет на выгрузку базы.
- **Триггеры задач**: для каждого типа — «начинать создавать с N числа месяца».

---

## Последовательность фаз (так и реализуем)

```
Ф1 (фундамент) → Ф2 (финансы) → Ф3 (ставки) → Ф4 (занятия) → Ф5 (CRM-UI) → Ф6 (права/задачи)
```

Финансовая логика (Ф2) опирается на матрицу из Ф1. Ставки (Ф3) опираются на правильно посчитанный chargeAmount из Ф2. UI в Ф5 опирается на модели Ф1–Ф3. Права в Ф6 — изолированный слой, делаем последним, чтобы не мешать тестам.

---

## Фаза 1 — Матрица посещений и базовые модели

### 1.1 Расширение AttendanceType (п.3 + п.6)

Файл схемы: [app/prisma/schema.prisma:450-467](app/prisma/schema.prisma#L450-L467) — модель `AttendanceType`.

Архитектурно: `AttendanceType.tenantId` уже опционально (`String?`). Системные строки имеют `tenantId=null` и доступны всем тенантам, кастомные принадлежат конкретному tenant. CRUD кастомных строк делается под текущим tenant.

Добавить поля (миграция Prisma):
- `availableToInstructor: Boolean @default(false)` — «доступно педагогу» (фильтрует выпадашку отметки в карточке занятия).
- `partOfPlan: Boolean @default(true)` — «План» (учитывается в прогнозе занятий).
- `partOfFact: Boolean @default(false)` — «Факт» (входит в фактически посещённое).
- `partOfForecast: Boolean @default(false)` — «Прогноз» (входит в прогноз выручки/списаний).
- `chargePercent: Int @default(100)` — процент списания (0–100). Применяется к `lessonPrice` при `chargesSubscription=true`. Дробь занятия не вводим: считаем по деньгам, остаток занятий уменьшается на 1, разница `lessonPrice * (1 - p/100)` фиксируется как штраф/доплата (точный механизм решаем в Ф2).
- `chargesSubscription: Boolean` — уже есть, оставляем (Расчёт = да/нет).
- `paysInstructor: Boolean` — уже есть, оставляем (Начисление ЗП).
- `countsAsRevenue: Boolean` — уже есть, оставляем.

Поле `refundsClientBalance` НЕ вводим — возврат денег возникает автоматически при отмене статуса «Был» в режиме разового посещения (без абонемента), это обрабатывается логикой отмены отметки в Ф2.1, не свойством типа.

**Seed-матрица по умолчанию** ([app/prisma/seed-attendance-types.ts](app/prisma/seed-attendance-types.ts)) — 6 системных строк:

| Код | Название | Доступно педагогу | План | Факт | Прогноз | Расчёт | ЗП |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `present` | Был | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `no_show` | Не был | ✓ | ✓ | — | ✓ | ✓ | — |
| `excused` | Уваж. пропуск | — | ✓ | — | — | — | — |
| `absent` | Прогул | — | ✓ | — | ✓ | ✓ | ✓ |
| `recalc` | Перерасчёт | — | — | — | — | — | — |
| `makeup` | Отработка | — | — | ✓ | ✓ | ✓ | ✓ |

«Не был» — промежуточный статус (оператор перевёл потом в УП/Прогул/Отработку).
По «Уваж. пропуск» — занятие НЕ сгорает, остаётся в абонементе (вариант А из риска №1, подтверждено пользователем).

### 1.2 UI настройки матрицы (полноценный CRUD)

Новая страница `app/src/app/(dashboard)/settings/attendance-matrix/page.tsx`.

- Таблица: 6 системных строк + N кастомных. Столбцы — 6 флагов и поле `chargePercent` (показывается только когда «Расчёт=да», ввод числа 1–100, по умолчанию 100).
- Кнопка «+ Добавить тип» открывает модалку: название + 6 галочек + chargePercent → POST `/api/attendance-types` создаёт строку с текущим `tenantId`.
- Inline-редактирование флагов / автокнопка «Сохранить» — PATCH `/api/attendance-types/[id]`.
- Системные строки (`isSystem=true`): можно менять название и флаги, нельзя менять `code` и нельзя удалять (только скрыть через `isActive=false`).
- Кастомные: можно всё, кроме удаления если есть связанные `Attendance` (DELETE возвращает 409 с подсказкой «деактивируйте»).
- Запись в `AuditLog` при изменении (для расследования «почему вдруг ЗП не начисляется») — если AuditLog есть; если нет — пропускаем, добавим в Ф6.

API:
- `GET /api/attendance-types` — возвращает системные (tenantId=null) + кастомные текущего tenant.
- `POST /api/attendance-types` — создать кастомный.
- `PATCH /api/attendance-types/[id]` — редактировать (проверка прав на системные/чужие).
- `DELETE /api/attendance-types/[id]` — удалить кастомный без Attendance.

### 1.3 Базовая ревизия модели баланса (п.15)

Файл схемы: модели `Client`, `Subscription`, `ClientBalanceTransaction`.

Изменения:
- В `ClientBalanceTransaction` ([app/prisma/schema.prisma:1369-1397](app/prisma/schema.prisma#L1369-L1397)) расширить enum `BalanceTransactionType`:
  - `subscription_issued` (списание полной стоимости при выписке абонемента)
  - `lesson_refund` (возврат за УП)
  - `personal_lesson_charge` (списание за персональное занятие)
  - `attendance_revert` (откат списания при удалении/изменении отметки или переносе даты)
- Добавить опциональные ссылки: `lessonId`, `directionId`, `attendanceId`. Это даёт ответ на п.12 «откуда долг» — каждая транзакция помнит, чем вызвана.

`Subscription.balance` оставляем как **остаток занятий** (не денег) — пользователь подтвердил две метрики.

---

## Фаза 2 — Финансовая логика (списания, возвраты, разовое)

### Семантика балансов (зафиксировано после разведки)

В коде уже есть две сущности, которые НЕ путаем:
- `Client.clientBalance` — «кошелёк клиента» в ₽. Может уйти в минус (долг).
- `Subscription.balance` — финансовый остаток абонемента в ₽ (НЕ количество занятий!). Уменьшается с каждой отметкой посещения, не уходит в минус. Когда `balance=0` — абонемент полностью выработан.
- Количество «отработано/осталось занятий» — вычисляется как `totalLessons - count(Attendance where chargeAmount > 0)`, отдельного поля нет.

`ClientBalanceTransaction` сейчас существует в схеме, но НИ ОДНО место в коде не создаёт записи. В Ф2 он становится единым ledger'ом всех операций по `Client.clientBalance`.

### 2.0 Schema-миграция (фундамент Ф2)

Файл: [app/prisma/schema.prisma](app/prisma/schema.prisma).

- Расширить enum `BalanceTransactionType` (текущие: `payment_received`, `subscription_remainder`, `refund`, `correction`, `transfer_to_subscription`). Добавить:
  - `subscription_issued` — выписан абонемент, минус с clientBalance.
  - `lesson_refund` — возврат недосписанного при `chargePercent < 100`.
  - `personal_lesson_charge` — списание за персональное занятие (для Ф4).
  - `attendance_revert` — откат при отмене/изменении отметки.
  - `subscription_closed_refund` — возврат остатка при закрытии.
- В `ClientBalanceTransaction` ([schema.prisma:1374-1402](app/prisma/schema.prisma#L1374-L1402)) добавить опц. поля: `lessonId`, `directionId`, `attendanceId`, `balanceAfter` (снапшот баланса после операции — для аудита и отчётов).
- В `Direction` ([schema.prisma:320-345](app/prisma/schema.prisma#L320-L345)) добавить `singleVisitPrice: Decimal?`.

SQL-миграция: `app/prisma/migrations/20260525130000_balance_ledger_extend/migration.sql`.

### 2.1 Утилита balance/transactions.ts

Новый файл: `app/src/lib/balance/transactions.ts`.

Единая функция:
```ts
applyBalanceDelta(tx, {
  tenantId, clientId, delta, type, refs: { subscriptionId?, paymentId?, lessonId?, directionId?, attendanceId? }, comment?, createdBy?
}) → { newBalance, transaction }
```

- Атомарно: `Client.clientBalance += delta`, создаёт `ClientBalanceTransaction` с заполненным `balanceAfter`.
- Используется во всех точках мутации `clientBalance` ниже. Прямые `prisma.client.update({ clientBalance: ... })` ЗАПРЕЩЕНЫ в новом коде.

### 2.2 Списание с clientBalance при выписке абонемента

Файл: [app/src/app/api/subscriptions/route.ts:58-123](app/src/app/api/subscriptions/route.ts#L58-L123).

При создании Subscription (статус `pending` или `active`):
- Транзакционно: создаём Subscription, потом `applyBalanceDelta(clientId, -finalAmount, "subscription_issued", { subscriptionId, directionId })`.
- `clientBalance` уходит в минус, если оплат не было — это нормально (это долг).

Текущее поведение в [/api/payments/route.ts:156-160](app/src/app/api/payments/route.ts#L156-L160) — `Client.clientBalance += amount` при оплате — оставляем, только переключаем на `applyBalanceDelta(client, +amount, "payment_received", { paymentId })`.

### 2.3 chargePercent при отметке посещений (механика)

Семантика (зафиксировано пользователем):

Пример: цена занятия 1000₽, статус «Прогул» с `chargePercent=50%`, в абонементе 8 занятий (8000₽).

1. С `Subscription.balance` списывается **полная цена занятия** (1000₽) → balance 8000 → 7000. Занятие считается «использованным».
2. На `Client.clientBalance` возвращается **недосписанная часть** (500₽) — клиент платил за полное занятие, а отработал только 50%, разницу возвращаем.
3. Итого «отработано» 1 занятие из 8, осталось 7 занятий за 7000₽, клиенту вернули 500₽.

Формула:
```
chargeAmount      = subscription.lessonPrice      // всегда полная цена
subscription.balance       -= chargeAmount        // занятие ушло целиком
subscription.chargedAmount += chargeAmount
refundDelta = lessonPrice * (100 - chargePercent) / 100
if (refundDelta > 0) applyBalanceDelta(client, +refundDelta, "lesson_refund", { lessonId, attendanceId, directionId })
```

При chargePercent=100 (по умолчанию) refundDelta=0, поведение полностью совместимо с текущим.

Файл: [app/src/app/api/lessons/[id]/attendance/route.ts:60-271](app/src/app/api/lessons/[id]/attendance/route.ts#L60-L271).
- POST: применить формулу выше. Заполнять `ClientBalanceTransaction` при refundDelta > 0.
- Существующий откат при смене статуса ([строки 152-162](app/src/app/api/lessons/[id]/attendance/route.ts#L152-L162)): добавить откат refundDelta — `applyBalanceDelta(client, -previousRefund, "attendance_revert")`.
- ЗП по `paysInstructor` оставляем как есть, для Ф3.

### 2.4 DELETE отметки (новый endpoint)

Сейчас DELETE отсутствует — только смена типа через PATCH. Для переноса даты (Ф4) и для ручной коррекции нужен явный DELETE.

Файл: [app/src/app/api/lessons/[id]/attendance/route.ts](app/src/app/api/lessons/[id]/attendance/route.ts) — добавить `DELETE` или новый ресурс `DELETE /api/attendances/[id]`.

Логика:
- `subscription.balance += attendance.chargeAmount`, `chargedAmount -= attendance.chargeAmount`.
- Если был `lesson_refund` — откатить: `applyBalanceDelta(client, -refundDelta, "attendance_revert")`.
- Если был `instructorPayAmount` и он ещё не выплачен (нет SalaryPayment за этот период) — снять. Иначе создать `SalaryAdjustment(type=correction, amount=-X)`.
- Удалить Attendance.

### 2.5 Возврат на clientBalance при закрытии абонемента

Файл: [app/src/app/api/subscriptions/[id]/refund/route.ts:25-164](app/src/app/api/subscriptions/[id]/refund/route.ts#L25-L164).

Текущая логика — возврат как `Payment refund` на финансовый счёт (касса). По решению пользователя меняем:
- Расчёт `refundAmount` по остатку (как сейчас).
- Вместо `Payment refund` → `applyBalanceDelta(client, +refundAmount, "subscription_closed_refund", { subscriptionId, directionId })`.
- `Subscription.status = closed`, `withdrawalReasonId`, `withdrawalDate` — как сейчас.
- Если клиент потом захочет «забрать деньги наличными» — это отдельная операция «выплата с баланса» (вне Ф2, добавим при необходимости).

`transfer-balance` ([app/src/app/api/subscriptions/[id]/transfer-balance/route.ts](app/src/app/api/subscriptions/[id]/transfer-balance/route.ts)) — НЕ трогаем, работает корректно.

### 2.6 Direction.singleVisitPrice + UI (п.8)

- Schema: добавлено в 2.0.
- UI: [app/src/app/(dashboard)/settings/edit-direction-dialog.tsx:34-40](app/src/app/(dashboard)/settings/edit-direction-dialog.tsx#L34-L40) — добавить поле «Стоимость разового посещения». Используется в Ф4 (кнопка «Добавить ученика»).

### 2.7 Backfill исторических данных

Новый файл: `app/prisma/scripts/backfill-client-balances.ts` (запуск вручную, не в обычной миграции).

Для каждого клиента (по `tenantId`):
1. Обнулить `Client.clientBalance = 0`, удалить все ClientBalanceTransaction.
2. Собрать события: все `Payment` (incoming) + все `Subscription` (по `createdAt`) + все `Attendance` с `chargePercent < 100` (после Ф2.3) + все закрытые Subscription с возвратом, упорядочить по дате.
3. Прогнать события через `applyBalanceDelta` в их хронологическом порядке.
4. Залогировать итоговый `clientBalance` и количество транзакций.

Запуск: `docker compose exec app npx tsx prisma/scripts/backfill-client-balances.ts` на dev после деплоя Ф2.

### 2.8 Долги в отчётах с указанием источника (п.12)

Файл: вероятно `app/src/app/(dashboard)/finance/debtors/page.tsx` (проверить при реализации).

- В отчёте по должникам джойним `ClientBalanceTransaction` (с `balanceAfter < 0` или с `type=subscription_issued`/`personal_lesson_charge`).
- Группировка по `directionId` и/или `subscriptionId` — показываем «долг 3000₽ по направлению "Танцы", абонемент за май».
- Для долгов по разовым посещениям (`personal_lesson_charge`) — показываем `lessonId` и дату.

### Стратегия коммитов Ф2

- C1: 2.0 (schema/миграция) + 2.1 (утилита) + 2.2 (списание при выписке). Тонкий слой — без рисков для UI.
- C2: 2.3 (chargePercent) + 2.4 (DELETE). Логика отметки переписывается, нужен прогон тестов посещений.
- C3: 2.5 (refund на clientBalance). Меняет flow возврата абонементов.
- C4: 2.6 (Direction.singleVisitPrice + UI). Изолировано.
- C5: 2.7 (backfill-скрипт). Без автозапуска — Анна или я запускаем вручную после C1-C3.
- C6: 2.8 (отчёт по должникам с источником).

Каждый коммит — push в main, CI Deploy to dev, проверка статуса. Если что-то ломается — фиксим до следующего.

---

## Фаза 3 — Ставки педагогов (п.1 + п.2)

### 3.1 Расширение модели ставок

Файл: [app/prisma/schema.prisma:487-503](app/prisma/schema.prisma#L487-L503).

Расширить `enum SalaryScheme`:
- `per_student` (есть)
- `per_lesson` (есть)
- `fixed_plus_per_student` (есть) — оставляем для совместимости
- `percent_of_payments` — НОВОЕ: процент от суммы фактических списаний с абонементов за занятие
- `floating_by_students` — НОВОЕ: плавающая матрица «N учеников → ставка»

Расширить `SalaryRate`:
- `percentOfPayments: Decimal?` (для схемы percent_of_payments)
- Новая связанная таблица `SalaryRateBracket { id, salaryRateId, minStudents, ratePerLesson }` — строки матрицы «1–3 учеников → 400₽, 4 → 500₽, 5 → 600₽…».
- Рекомендация UI: предлагать заполнить до 12 учеников (валидация — предупреждение, не блокер).

### 3.2 Ставка на группу (п.2)

Новая модель `GroupSalaryRate`:
```
GroupSalaryRate {
  id, tenantId, groupId, scheme (SalaryScheme),
  ratePerStudent?, ratePerLesson?, fixedPerShift?, percentOfPayments?,
  brackets: SalaryRateBracket[]
}
```

Связь: `Group → GroupSalaryRate?` (1:1, опционально).

### 3.3 Приоритет выбора ставки

При расчёте ЗП за конкретное занятие (для конкретного инструктора, в т.ч. замены):
1. Если у группы есть `GroupSalaryRate` → берём её для ВСЕХ педагогов (включая замену) — это полностью перекрывает их личные ставки.
2. Иначе ищем `SalaryRate` инструктора с конкретным `directionId` (исключение).
3. Иначе ищем `SalaryRate` инструктора без `directionId` (ставка по умолчанию).
4. Если нет — ЗП = 0, логируем предупреждение для отчёта «педагоги без ставки».

Точка применения: [app/src/app/api/lessons/[id]/attendance/route.ts:105-133](app/src/app/api/lessons/[id]/attendance/route.ts#L105-L133) и [app/src/app/api/trial-lessons/[id]/route.ts:17-57](app/src/app/api/trial-lessons/[id]/route.ts#L17-L57). Вынести в общую утилиту `app/src/lib/salary/resolve-rate.ts` + `calc-pay.ts`.

При плавающей матрице: количество учеников = count(Attendance, где partOfFact=true) для этого занятия.

### 3.4 UI редактирования ставок

- Карточка инструктора [app/src/app/(dashboard)/staff/edit-employee-dialog.tsx:45-100](app/src/app/(dashboard)/staff/edit-employee-dialog.tsx#L45-L100): новая секция «Оплата». Сначала выбор схемы (4 варианта), поля в зависимости от схемы, кнопка «Добавить исключение» (направление + альтернативная схема).
- Карточка группы [app/src/app/(dashboard)/schedule/groups/edit-group-dialog.tsx](app/src/app/(dashboard)/schedule/groups/edit-group-dialog.tsx): новая секция «Ставка для группы (перебивает ставки педагогов)», по умолчанию пусто.

API:
- `POST/PATCH/DELETE /api/employees/[id]/salary-rates`
- `POST/PATCH/DELETE /api/groups/[id]/salary-rate`

### 3.5 Замена инструктора

Подтверждение текущего поведения [app/src/app/api/lessons/[id]/route.ts:101](app/src/app/api/lessons/[id]/route.ts#L101): `effectiveInstructorId = substituteId || instructorId`. После Ф3 — приоритет 1 (GroupSalaryRate) применяется ко всем, иначе берём ставку `effectiveInstructorId`. Логика уже корректна по требованию пользователя.

---

## Фаза 4 — Занятия (карточка)

### 4.1 Редактирование даты/времени (п.4)

Файл API: [app/src/app/api/lessons/[id]/route.ts:7-17](app/src/app/api/lessons/[id]/route.ts#L7-L17) — расширить PATCH-схему полями `date`, `startTime`, `durationMinutes`.

Логика:
1. Проверка прав:
   - Если `attendances` пусто → разрешено для ролей `admin`, `manager`, `owner`.
   - Если есть отметки → только `manager`, `owner`. Иначе 403.
2. Проверка конфликта (педагог/кабинет уже занят) → возвращаем 409 с деталями; фронт показывает модалку подтверждения.
3. Если перенос подтверждён и были отметки → транзакционно:
   - Для каждой Attendance: откат списания/возврата/ЗП (см. Ф2.1).
   - Удалить Attendance.
   - Сменить date/startTime/durationMinutes.
   - Перепривязать TrialLesson по `lessonId` (даты не нужно править — связь по ID).
4. Запись в `AuditLog` (новая таблица или существующая, если есть): кто, когда, что изменил.

UI: [app/src/app/(dashboard)/schedule/lessons/[id]/page.tsx](app/src/app/(dashboard)/schedule/lessons/[id]/page.tsx) — кнопка «Перенести», модалка с двумя шагами (выбор новой даты/времени → подтверждение с предупреждением).

### 4.2 Кнопка «Добавить ученика» (п.5)

UI: на той же странице [app/src/app/(dashboard)/schedule/lessons/[id]/page.tsx], кнопка возле списка учеников.

Модалка:
1. Поиск ребёнка (любой Ward в этом tenant, у которого есть Client). Фильтр: «у которого есть подписка на это направление» — приоритет в выдаче, но не ограничение.
2. Источник списания (выбор оператора):
   - **Абонемент** (если есть active Subscription на это направление с balance > 0) — `subscription.balance -= 1`.
   - **Баланс родителя** — списать по `Direction.singleVisitPrice` (если нет — `lessonPrice`).
3. Флажок «Разовое» — если включён, ребёнок НЕ зачисляется в группу (`Enrollment` не создаётся). Если выключен — добавляется в группу как полноценный участник.
4. Поле «Стоимость» (предзаполнено из направления, можно править) — только когда источник = баланс родителя.

API: новый `POST /api/lessons/[id]/add-student`.

### 4.3 Тип дня группы (п.3, уточнение)

В вопросах пользователь упомянул «Тип дня» в карточке группы расписания. Текущая модель — `GroupScheduleTemplate` (день недели + время). Понятия «тип дня» (рабочий/каникулы) сейчас нет.

Решение: трактуем «Тип дня» как **тип конкретного занятия** (Lesson) — это и есть AttendanceType-логика. Дополнительной сущности «тип дня в шаблоне» не вводим — это избыточно для MVP. Если Анна имела в виду другое (например, проставить «каникулы» на день, чтобы все занятия в этот день автоматически были каникулярными) — это уточняем отдельно в Q&A.

---

## Фаза 5 — CRM, дети, абонементы, история

### 5.1 Столбцы в вкладке «Абонементы» (п.7)

Файл: [app/src/app/(dashboard)/crm/clients/client-tabs.tsx:829-943](app/src/app/(dashboard)/crm/clients/client-tabs.tsx#L829-L943) — таблица абонементов.

Текущие столбцы: Ребёнок, Направление, Группа, Период, Статус, К оплате, Оплачено.

Добавить:
- **Полная стоимость** — `subscription.finalAmount` (после скидок).
- **Отработано** — `subscription.totalLessons − subscription.balance` (число занятий).
- **Остаток** — `subscription.balance` (число занятий).

### 5.2 Реестр Детей: фильтры, сортировка, состояние «Активный» (п.9 + п.10)

Файл: [app/src/app/(dashboard)/crm/children/children-table.tsx:68-170](app/src/app/(dashboard)/crm/children/children-table.tsx#L68-L170).

- Добавить столбец «Состояние» с 4 значениями: Активный (вычисляемое), Архив, ЧС, Нецелевой. Для Архив/ЧС/Нецелевой — берём из текущих полей (`Client.funnelStatus`/`clientStatus`, проверяем в коде).
- «Активный» вычисляется на бэке: `Ward` имеет ≥1 активный `Subscription` ИЛИ числится в `Enrollment` активной группы. Возвращать как computed-поле в `GET /api/wards` или `GET /api/children`.
- Включить сортировку по всем столбцам (использовать существующий паттерн `sort` query-param).
- Фильтры: Состояние (мультивыбор), Телефон (поиск по родителю), Возраст (диапазон от-до), Филиал (мультивыбор).

API расширить: `GET /api/children?status=&phone=&ageFrom=&ageTo=&branchId=`.

### 5.3 История в карточке ребёнка (п.11)

Реализация уже имеется для клиента: [app/src/app/(dashboard)/crm/clients/[id]/client-history.tsx:1-232](app/src/app/(dashboard)/crm/clients/[id]/client-history.tsx#L1-L232) + API `/api/clients/{id}/timeline`.

Стратегия — **переиспользовать компонент** с параметром `scope`:
- Новый эндпоинт `GET /api/wards/{id}/timeline` или расширить существующий: `GET /api/clients/{clientId}/timeline?wardId=X`.
- Возвращает только события, относящиеся к этому ребёнку: пробные, абонементы, посещения, статусы, задачи.
- НЕ возвращает: коммуникации родителя, оплаты родителя (они общие на семью).
- В компонент `<ClientHistory />` пробросить опцию `wardId` для фильтрации источника.
- Вставить компонент в страницу карточки ребёнка `app/src/app/(dashboard)/crm/wards/[id]/page.tsx` (или как там называется).

---

## Фаза 6 — Права, видимость, задачи

### 6.1 Глобальный выключатель «скрывать номера у инструктора» (п.13)

- В `Organization` (или `OrganizationSettings`) добавить поля: `hidePhonesFromInstructors: Boolean`, `restrictClientExport: Boolean`.
- Middleware/хелпер `app/src/lib/permissions/phone-visibility.ts`: функция `maskPhone(phone, currentUserRole, settings)` — возвращает `***-**-**` для инструктора, если флаг включён.
- Применить в:
  - `GET /api/clients` (response shaping)
  - `GET /api/children`
  - `GET /api/groups/[id]` (список зачисленных)
  - Компоненты-таблицы: contacts-table, children-table.
- Экспорт XLSX/CSV [app/src/lib/export-excel.ts:22-68](app/src/lib/export-excel.ts#L22-L68) + кнопка экспорта: если `restrictClientExport=true`, разрешаем только владельцу.

UI настройки: в существующих настройках организации новая секция «Безопасность данных».

### 6.2 Настройки автотриггеров задач (п.14)

Поиск: текущие 5 автотриггеров задач (упомянуты в CLAUDE.md). Предположительно в `app/src/lib/tasks/` или `app/src/app/api/tasks/cron`.

- Новая модель/JSON `TaskTriggerSettings`:
  ```
  { trigger: "debtor"|"missed"|"subscription_expiring"|..., 
    enabled: boolean, 
    startDayOfMonth: number? }
  ```
  Хранить в `Organization.settingsJson` или отдельной таблице.
- В планировщике задач: перед созданием задачи проверять `enabled` и (если `startDayOfMonth` задан) что сегодня ≥ N.
- UI: страница `settings/tasks` со списком триггеров, чекбоксом «вкл», числовым полем «с N числа месяца».

### 6.3 Настройки кампаний (п.14, второй абзац)

Файл: где сейчас кампании обзвона (искать `campaigns`). Добавить в карточку кампании выбор «какие типы задач включаются в эту кампанию» (чекбоксы по типам).

---

## Файлы — итоговый список (для исполнителя)

**Схема и миграции:**
- [app/prisma/schema.prisma](app/prisma/schema.prisma) — изменения в `AttendanceType`, `ClientBalanceTransaction`, `Direction`, `SalaryScheme`, `SalaryRate`, новые `SalaryRateBracket`, `GroupSalaryRate`, `OrganizationSettings`, `TaskTriggerSettings`.
- [app/prisma/seed-attendance-types.ts](app/prisma/seed-attendance-types.ts) — новый набор из 6 строк + флаги.

**API (новые/изменённые):**
- `app/src/app/api/attendance-types/[id]/route.ts` — PATCH флагов матрицы.
- [app/src/app/api/lessons/[id]/attendance/route.ts](app/src/app/api/lessons/[id]/attendance/route.ts) — переработка charge/refund/ЗП по новой матрице.
- [app/src/app/api/lessons/[id]/route.ts](app/src/app/api/lessons/[id]/route.ts) — расширить PATCH (date/startTime/duration + права + конфликт + откат отметок).
- `app/src/app/api/lessons/[id]/add-student/route.ts` — новый.
- `app/src/app/api/employees/[id]/salary-rates/route.ts` — CRUD ставок инструктора.
- `app/src/app/api/groups/[id]/salary-rate/route.ts` — ставка группы.
- `app/src/app/api/subscriptions/route.ts` — списание с `clientBalance` при выписке.
- `app/src/app/api/wards/[id]/timeline/route.ts` — история ребёнка.
- `app/src/app/api/children/route.ts` — фильтры/сортировка/computed «Активный».

**UI (новые/изменённые):**
- `app/src/app/(dashboard)/settings/attendance-matrix/page.tsx` — настройка матрицы.
- [app/src/app/(dashboard)/settings/edit-direction-dialog.tsx](app/src/app/(dashboard)/settings/edit-direction-dialog.tsx) — поле «Стоимость разового».
- `app/src/app/(dashboard)/settings/security/page.tsx` — флаги hide phones, restrict export.
- `app/src/app/(dashboard)/settings/tasks/page.tsx` — триггеры задач.
- [app/src/app/(dashboard)/staff/edit-employee-dialog.tsx](app/src/app/(dashboard)/staff/edit-employee-dialog.tsx) — секция «Оплата».
- [app/src/app/(dashboard)/schedule/groups/edit-group-dialog.tsx](app/src/app/(dashboard)/schedule/groups/edit-group-dialog.tsx) — секция «Ставка группы».
- [app/src/app/(dashboard)/schedule/lessons/[id]/page.tsx](app/src/app/(dashboard)/schedule/lessons/[id]/page.tsx) — кнопки «Перенести», «Добавить ученика».
- [app/src/app/(dashboard)/crm/clients/client-tabs.tsx](app/src/app/(dashboard)/crm/clients/client-tabs.tsx) — новые столбцы «Полная стоимость», «Отработано», «Остаток».
- [app/src/app/(dashboard)/crm/children/children-table.tsx](app/src/app/(dashboard)/crm/children/children-table.tsx) — фильтры, сортировка, столбец «Состояние».
- `app/src/app/(dashboard)/crm/wards/[id]/page.tsx` — встроить `<ClientHistory wardId={...} />`.
- [app/src/app/(dashboard)/crm/clients/[id]/client-history.tsx](app/src/app/(dashboard)/crm/clients/[id]/client-history.tsx) — пробросить `wardId` через пропс.

**Утилиты:**
- `app/src/lib/salary/resolve-rate.ts` — выбор ставки (приоритет группа → исключение → дефолт).
- `app/src/lib/salary/calc-pay.ts` — расчёт для всех 4 схем (включая плавающую матрицу).
- `app/src/lib/permissions/phone-visibility.ts` — маскирование номеров.
- `app/src/lib/balance/transactions.ts` — единая точка для всех операций с балансом + создание `ClientBalanceTransaction` с пометкой источника.

**Документация:**
- [docs/PRD.md](docs/PRD.md) — обновить раздел финансов, ставок, матрицы.
- [docs/reports-logic.md](docs/reports-logic.md) — пересчитать формулы списаний с учётом матрицы.
- [docs/data-dictionary.md](docs/data-dictionary.md) — описать новые поля.
- [app/src/lib/page-help-content.ts](app/src/lib/page-help-content.ts) — справка для новых страниц (settings/attendance-matrix, settings/security, settings/tasks).

---

## Нестыковки и риски — мой разбор

1. **Возврат за УП vs отработка**. Пользователь сформулировал: «УП — возвращается на баланс, отработки не возвращаются, а списываются с абонемента». В моей матрице по умолчанию УП имеет `refundsClientBalance=true` и `chargesSubscription=false`. То есть занятие в абонементе остаётся, плюс деньги возвращаются — это **двойная компенсация**. Скорее всего правильнее: УП = `chargesSubscription=true, refundsClientBalance=true` (списали занятие, вернули деньги — эквивалентно «купил отдельный урок взамен пропавшего»). **Открытый вопрос для уточнения после ExitPlanMode**.

2. **«Тип дня» в карточке группы расписания**. В коде сейчас этого понятия нет. В плане я предположил, что это синоним AttendanceType (статус занятия), а не атрибут шаблона. Если Анна имела в виду «отметить день каникул на уровне шаблона» — это потребует отдельной модели `ScheduleException` и логики массовой отметки. Уточнить.

3. **Плавающая ставка и ставка группы**. Если в группе задана фиксированная ставка `per_lesson=500₽`, а у педагога была плавающая по матрице — ставка группы полностью перекрывает. То есть `GroupSalaryRate` поддерживает любую из 4 схем, не только число. Это уже учтено в 3.2.

4. **«Не был» как промежуточный статус**. По матрице — списывает с абонемента, ЗП не начисляет. Это рискованно: если оператор забыл перевести в финальный статус — посещение не оплачено педагогу. Mitigation: в задачи добавить триггер «занятия со статусом Не был старше 7 дней».

5. **Откат при переносе даты**. Если занятие было давно и по нему уже выплачена ЗП (`SalaryPayment` создан), откат `Attendance.instructorPayAmount` не вернёт деньги педагогу. Нужно либо блокировать перенос после выплаты, либо создавать `SalaryAdjustment(type=correction, amount=-X)`. Предлагаю **блокировать** перенос занятий из закрытого периода — это согласуется с концепцией «мягкого закрытия периода» (CLAUDE.md).

6. **Миграция существующих данных**. На dev уже есть тестовые абонементы, посещения, ЗП. Старая модель не имела `subscription_issued` в транзакциях. Нужен миграционный скрипт: для каждого существующего Subscription создать ретроактивно ClientBalanceTransaction (`type=subscription_issued`) и пересчитать `clientBalance` от нуля. Иначе балансы в UI «сломаются».

7. **п.3 — переименование «Неуваж пропуск» → «Прогул»**. В коде сейчас уже есть статус с кодом `absent` и названием «Прогул» ([app/prisma/seed-attendance-types.ts:8-11](app/prisma/seed-attendance-types.ts#L8-L11)). Проверить, нет ли в UI-метках где-то остатков «Неуваж. пропуск» — отдельный точечный grep по проекту перед коммитом.

---

## Верификация (как тестируем после реализации)

**Сценарий 1 — Полный цикл денег с минусом:**
1. Создать клиента с балансом 0.
2. Выписать абонемент на 8000₽ (8 занятий × 1000₽). Проверить: `clientBalance = -8000`, в журнале — `subscription_issued`.
3. Внести оплату 5000₽. Проверить: `clientBalance = -3000`.
4. Отметить 1 посещение «Был». Проверить: `subscription.balance = 7`, `clientBalance = -3000` (не изменился).
5. Отметить 1 посещение «УП с возвратом». Проверить: `clientBalance = -2000` (вернулось 1000), либо `subscription.balance = 8` (вернулось занятие) — в зависимости от итогового решения по риску №1.

**Сценарий 2 — Ставки:**
1. Педагог: плавающая матрица (1-3 → 400, 4 → 500, 5 → 600).
2. На занятии 4 ученика отмечены «Был». Ожидаем ЗП = 500.
3. Та же группа — задать `GroupSalaryRate per_lesson=1000`. Та же ситуация → ЗП = 1000 (группа перебивает).
4. Замена педагога без ставки → ЗП = 1000 (всё равно по группе).
5. Снять `GroupSalaryRate` → замена с per_student=200, 4 ученика → ЗП = 800.

**Сценарий 3 — Перенос даты:**
1. Занятие с 3 отметками. Залогиниться админом → кнопка «Перенести» неактивна.
2. Войти управляющим → активна. Модалка предупреждения. Подтвердить → отметки сняты, списания/ЗП откачены, дата изменена. В аудите запись.

**Сценарий 4 — Добавить ученика:**
1. Открыть карточку занятия по направлению «Танцы». Кнопка «Добавить ученика».
2. Выбрать ребёнка БЕЗ абонемента. Модалка предлагает только «баланс родителя». Цена = `singleVisitPrice` направления.
3. Включить «Разовое» — `Enrollment` не создаётся.
4. Выбрать ребёнка С активным абонементом — модалка предлагает оба варианта.

**Сценарий 5 — Реестр Детей:**
1. Открыть `/crm/children`. Видна колонка «Состояние».
2. У ребёнка с активным абонементом — «Активный». Закрыть абонемент → переходит в другой статус.
3. Применить фильтры «Возраст 5–7» + «Филиал X» → таблица отфильтрована.
4. Сортировать по столбцу «Возраст» — работает.

**Сценарий 6 — Видимость номеров:**
1. Владельцем включить «Скрывать у инструктора» и «Запрет выгрузки».
2. Войти инструктором — в таблице клиентов номера `***-**-**`.
3. Войти инструктором — кнопка экспорта недоступна.
4. Войти владельцем — всё видно, экспорт работает.

**Технические проверки:**
- `pnpm typecheck`, `pnpm lint` — без ошибок.
- Playwright супертест ([app/](app/)) — прогнать существующий, дополнить кейсами 1–6.
- Миграция данных: dev-снепшот перед миграцией, сравнить балансы до/после, погрешность = 0.
- CI должен пройти; в случае проблем — починить до следующей фичи (CLAUDE.md).
