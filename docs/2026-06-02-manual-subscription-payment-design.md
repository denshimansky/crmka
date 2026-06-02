# Ручная оплата абонементов: отказ от автозачисления + кнопка «Оплатить»

Дата: 2026-06-02. Автор: Денис.

## Контекст

Сейчас в `POST /api/payments` есть «автозачисление»: после поступления
оплаты CRM сама находит pending-абонементы клиента по `startDate ASC` и
активирует их одну за другой, пока на балансе родителя есть деньги. Это
плохо, потому что:

- оплату могут принять «не за тот месяц / не на того ребёнка»;
- админ теряет контроль, кому именно зачислен платёж;
- частые жалобы «оплатили один абон, активировался другой».

Меняем модель: **CRM ничего не закрывает сама**. Родитель пополняет
кошелёк, а в счёт абонементов админ зачисляет вручную — либо кнопкой
«Оплатить» в карточке ребёнка, либо в диалоге распределения прямо в
форме платежа. Частичные оплаты разрешены.

Балансы клиентов в проде не трогаем. `subscription_issued` при выписке
остаётся — он балансирует учёт прямых платежей с `subscriptionId`.

## Что отрезаем

В [app/src/app/api/payments/route.ts](app/src/app/api/payments/route.ts),
строки 243–324 — цикл `while (clientBalance > 0)` + последующий
`updateMany` статуса клиента в `active_client`. Полностью удаляем.

Что остаётся в `POST /api/payments`:

- создание `Payment type=incoming` и `accountId.balance += amount`;
- `applyBalanceDelta(type=payment_received, +amount)` на клиента;
- если в теле явно указан `subscriptionId` — текущая логика
  (`subscription.balance -= amount`, при pending → active, очистка
  `salesStage`) сохраняется без изменений;
- активация клиента при первой оплате (`isFirstPayment`) тоже
  сохраняется.

Yookassa-webhook не трогаем: там оплата приходит с явным
`subscriptionId` и эквивалентна ручному нажатию «Оплатить» в ЛК
клиента.

## Что добавляем

### 1. Новый сервис `lib/subscriptions/pay-from-balance.ts`

Функция `payFromBalance({ tenantId, subscriptionId, amount, createdBy })`:

- Загружает Subscription с `clientId`, `balance`, `status`, `chargedAmount`.
- Загружает `Client.clientBalance`.
- Валидация:
  - `amount > 0`,
  - `amount ≤ subscription.balance`,
  - `amount ≤ client.clientBalance`,
  - subscription не `deletedAt`, не `closed`, не `withdrawn`.
- Находит первый активный `FinancialAccount` тенанта (как в
  `transfer-balance`) для формальной привязки.
- В одной `db.$transaction`:
  - `Payment.create({ type: "transfer_in", method: "bank_transfer",
    subscriptionId, clientId, accountId, amount, date: today, comment:
    "Оплата с баланса родителя" })`;
  - `subscription.balance -= amount`, `chargedAmount += amount`;
  - если `balance == 0` и `status == "pending"` → `status = "active"`,
    `activatedAt = now`; очистка `salesStage` подопечного и
    `groupEnrollment.paymentStatus`;
  - `applyBalanceDelta(type: "transfer_to_subscription", delta: -amount,
    refs: { subscriptionId, paymentId, directionId })`.
- Возвращает `{ paymentId, newSubscriptionBalance, newClientBalance,
  becameActive }`.

ДДС не задет (`transfer_in` исключён из `/finance/dds`), в P&L
учитывается (там фильтр `[incoming, transfer_in]`), в карточке абона
видна строка платежа.

### 2. API `POST /api/subscriptions/[id]/pay-from-balance`

Body: `{ amount: number }`. Доступ — `owner`/`manager`/`admin`. Возвращает
результат `payFromBalance`. Аудит через `logAudit`.

### 3. API `POST /api/payments` — `distribution[]`

Расширяем `createSchema`:

```ts
distribution: z.array(z.object({
  subscriptionId: z.string().uuid(),
  amount: z.number().positive(),
})).optional()
```

Валидация:

- `Σ distribution.amount ≤ amount`;
- каждая позиция — Subscription того же клиента, без `deletedAt`, со
  статусом active/pending;
- `distribution[i].amount ≤ subscription.balance`.

В транзакции `POST /api/payments`:

- создаём Payment incoming + `applyBalanceDelta(payment_received)` как
  сейчас;
- для каждой позиции вызываем `payFromBalance(...)` внутри той же
  транзакции (функция принимает `Prisma.TransactionClient` опционально).

Так строки в `/finance/dds` остаётся одна (incoming), а в P&L и в
карточках абонов появляются позиции `transfer_in`.

### 4. UI: кнопка «Оплатить» в карточке ребёнка

Файл [app/src/app/(dashboard)/crm/clients/[id]/client-tabs.tsx](app/src/app/(dashboard)/crm/clients/[id]/client-tabs.tsx),
блок отображения абонементов. Возле каждой строки с `balance > 0`
(pending или active с недоплатой) — кнопка «Оплатить».

Диалог:

- заголовок: «Оплатить с баланса родителя»;
- показывает: текущий долг по абону, текущий `clientBalance`;
- поле ввода «Сумма»; default = `min(subscription.balance,
  client.clientBalance)`;
- кнопка «Списать N ₽» отправляет POST в новый эндпоинт;
- после успеха — `router.refresh()`, диалог закрывается.

Если `client.clientBalance ≤ 0` — кнопка дизейблится с тултипом
«Недостаточно средств на балансе родителя».

### 5. UI: блок распределения в форме создания Payment

В существующем диалоге «Добавить оплату» (используется на карточке
клиента и на странице `/finance/payments`), при выбранном клиенте:

- сразу под полем «Сумма» — раскрывающийся блок «Распределить на
  абонементы (N с долгом)»;
- список карточек: ФИО ребёнка · направление · долг ·
  `input[type=number]` к зачислению (default 0);
- внизу подсказка «Остаток X ₽ зачислится на баланс родителя».

Чекбокс «Распределить» свёрнут по умолчанию — никакой автоматики, всё в
кошелёк.

## Что НЕ трогаем

- `subscription_issued` при выписке (`POST /api/subscriptions` и
  `applyBulkRenew`) — остаётся, балансы существующих клиентов в проде не
  трогаются.
- YooKassa webhook — там оплата уже с явным subscriptionId, это
  эквивалент кнопки «Оплатить».
- Виджет «Должники» и `/finance/debtors` — продолжают смотреть на
  `clientBalance < 0`. С учётом сохранённого `subscription_issued`
  логика осталась прежней.
- Связанные скидки и `recalcLinkedDiscounts` — отдельная задача.

## Критические файлы

Новые:

- `app/src/lib/subscriptions/pay-from-balance.ts`
- `app/src/app/api/subscriptions/[id]/pay-from-balance/route.ts`

Правки:

- `app/src/app/api/payments/route.ts` — удалить цикл 243–324, добавить
  поддержку `distribution[]`.
- `app/src/app/(dashboard)/crm/clients/[id]/client-tabs.tsx` — кнопка
  «Оплатить» возле каждого абона с долгом.
- Форма «Добавить оплату» (диалог в `client-tabs.tsx` или
  `/finance/payments`) — блок распределения.
- `app/src/lib/page-help-content.ts` — обновить тексты для
  `crm/clients/[id]` (есть кнопка «Оплатить») и `finance/payments`
  (есть распределение).

## Верификация

1. Создаём pending абонемент. `Client.clientBalance` минусуется на
   `finalAmount` (без изменений).
2. Делаем Payment без `subscriptionId` и без `distribution[]`. Кошелёк
   родителя пополнился, **pending абон остался pending** — это и есть
   снятие автозачисления.
3. Открываем карточку ребёнка → возле pending-абона кнопка «Оплатить» →
   диалог → вводим часть суммы → отправляем. Результат:
   `subscription.balance` уменьшился, `chargedAmount` вырос, `status`
   остался pending (частичная), `Client.clientBalance` минус
   списанной суммы. В карточке абона видна строка `Оплата с баланса
   родителя · transfer_in · N ₽`.
4. Повторяем, вводя оставшуюся сумму. Теперь `balance == 0`, абон
   перешёл в `active`, `activatedAt` проставлен.
5. Создаём Payment с `distribution: [{ subA, X }, { subB, Y }]` через
   форму «Добавить оплату». Видим: одна строка `incoming` в ДДС, по
   одной строке `transfer_in` на каждую subN в их карточках, баланс
   родителя += (amount − X − Y), кошелёк закрыл часть долга.
6. ДДС за день: только incoming (без дублей).
7. Виджет «Должники» / `/finance/debtors` показывает того же клиента
   до и после серии действий — поведение не изменилось.
