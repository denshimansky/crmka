# Платное пробное занятие — списание с баланса родителя

- **Дата:** 2026-08-26
- **Статус:** дизайн утверждён, готов к плану реализации
- **Контекст:** [/api/trial-lessons/[id]](../../../app/src/app/api/trial-lessons/[id]/route.ts), [subscription-month-figures.ts](../../../app/src/lib/finance/subscription-month-figures.ts), [one-off-debt.ts](../../../app/src/lib/one-off-debt.ts)

## 1. Проблема

Настройка направления «Стоимость пробного» + галка «Бесплатное пробное занятие» создают ожидание, что за платное пробное деньги спишутся с баланса родителя. Фактически отметка пробного «Был» жёстко пишет `chargeAmount = 0` ([trial-lessons/[id]/route.ts](../../../app/src/app/api/trial-lessons/[id]/route.ts) стр. 330/345/413, [wards/[id]/route.ts:228](../../../app/src/app/api/wards/[id]/route.ts)), а `trialPrice` в коде используется лишь как дефолт флага «Оплата инструктору». Поэтому «Списание» — прочерк, баланс не тронут. Платного пробного, дебетующего родителя, в системе нет.

## 2. Цель

Сделать пробное платным для родителя: галка «Бесплатное пробное» в настройках направления управляет тем, списывается ли `trialPrice` с баланса родителя при отметке «Был». Оплата инструктору — отдельная настройка в его ставке (`trialPayMode`), её не трогаем.

## 3. Зафиксированные решения

| # | Решение | Значение |
|---|---------|----------|
| Сумма | Источник — галка «Бесплатное пробное» | `chargeable = !direction.trialFree`; `amount = chargeable ? trialPrice : 0`. Живые поля направления (как разовое берёт `singleVisitPrice ?? lessonPrice`), **без** скидок клиента, **без** версий DirectionPrice. `trialFree=true` или пустой `trialPrice` → 0 (списания нет). |
| Момент | Когда списываем | При отметке «Был» (`attended`). Откат — при сбросе / `no_show` / `cancelled`. Идемпотентно (повторный PATCH с той же суммой баланс не двигает). |
| Долг | Нет денег на балансе | Уводим в минус (долг), как разовое. |
| Тип проводки | **Вариант B** | Новый `BalanceTransactionType.trial_charge` для списания; возврат — существующим `attendance_revert`. |
| D2 | Бакет долга | Долг за пробное — в бакете «разовые посещения» раскладки должников (без отдельной строки «пробные»). |
| Выручка/ОПИУ | Считать пробные выручкой | **Да** — включается автоматически (движок ОПИУ фильтрует `countsAsRevenue`, не `isTrial`). |
| LTV | Считать в LTV | **Да** — авто (LTV суммирует `chargeAmount`). |
| Дата первой оплаты / конверсия | Считать | **Да** — ставим `firstPaidLessonDate`; лид считается покупкой в воронке и конверсии, `wasEverClient=true`. |
| Статус лида | Флип в `active_client` | **Нет** — «оставить в воронке» (funnelStatus не флипаем принудительно). |
| Остальные клиентские отчёты | new-client-income, churn-by-months | **Нет** — исключаем пробные (`isTrial:false`). |
| B1 | Дашборд-виджеты vs ОПИУ | «Отработанные абонементы» / «Ожидаемые поступления» остаются **абонементными** (по спеке Ани 09.08). Только **«Прогноз прибыли»** включает реализованную выручку пробных. |
| Зачёт в абонемент | is_trial_credited | **Вне scope** этой доработки. |

## 4. Архитектура изменений

### 4.1 Ядро списания (общий хелпер + две точки отметки)

Логику вынести в чистый хелпер, чтобы обе точки отметки не разъехались:

```
// lib/services/trial-charge.ts (новый)
computeTrialCharge(direction: {trialFree, trialPrice}): Prisma.Decimal
  → trialFree ? 0 : Decimal(trialPrice ?? 0)
```

**[trial-lessons/[id]/route.ts](../../../app/src/app/api/trial-lessons/[id]/route.ts)** — ветка `effectiveStatus === "attended"` (стр. ~284–354):
- вычислить `newCharge = computeTrialCharge(direction)` (направление подгрузить: для группового — `lesson.group.direction`, для индивидуального — по `trial.directionId`);
- `prevCharge = existingAtt?.chargeAmount ?? 0`;
- если `prevCharge !== newCharge`: откат старого (`attendance_revert +prevCharge`), затем списание нового (`trial_charge −newCharge`, comment «Пробное занятие», refs `{lessonId, attendanceId, directionId}`);
- писать `attendance.chargeAmount = newCharge` вместо `Decimal(0)` (стр. 330/345/413);
- **идемпотентность**: при том же `newCharge` (например переключение оплаты инструктору) баланс не двигаем.

Ветка `no_show / cancelled / scheduled`-сброс (стр. ~355–419):
- если нет выжившего attended-дубля (идём в `deleteMany`): перед удалением подгрузить текущую trial-attendance; если `chargeAmount>0` → `attendance_revert +chargeAmount` (refs `{lessonId, directionId}`, без `attendanceId` — строка удаляется), затем `deleteMany`;
- если выживший дубль есть (`updateMany`): списание принадлежит ему — не трогаем.

**[wards/[id]/route.ts:228](../../../app/src/app/api/wards/[id]/route.ts)** — та же отметка пробного «Был»: применить тот же хелпер и списание.

**firstPaidLessonDate:** в обеих точках при `attended` и `newCharge>0` проставить `Client.firstPaidLessonDate` (если пусто) — **без** флипа `funnelStatus`/`clientStatus`. На сбросе/`no_show`/`cancelled` — пересчитать `firstPaidLessonDate` через существующий сервис [client-first-paid-lesson-date.ts](../../../app/src/lib/services/client-first-paid-lesson-date.ts), чтобы не осталась «зависшая» дата (баг-паттерн stale firstPaidLessonDate).

### 4.2 Тип проводки `trial_charge` (5 обязательных точек)

Разведка подтвердила: за пределами этих файлов потребителей типа проводки нет.

1. **[schema.prisma](../../../app/prisma/schema.prisma)** `enum BalanceTransactionType` (~2457) — добавить `trial_charge`.
2. **Новая миграция** (клон `20260525130000_balance_ledger_extend`) — `ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'trial_charge';`. Катит CI на прод (локально миграции не гоняем).
3. **[one-off-debt.ts:62-66](../../../app/src/lib/one-off-debt.ts)** — в запрос `charges` добавить `trial_charge` наравне с `personal_lesson_charge`. **Критично:** возврат идёт `attendance_revert` (уже вычитается запросом `reverts`), поэтому без добавления `trial_charge` в приход долг недосчитается/станет невидим. Симметрия: `oneOffNet = (personal_lesson_charge + trial_charge) − attendance_revert(sub=null)`.
4. **[balance-transactions/route.ts:12-26](../../../app/src/app/api/clients/[id]/balance-transactions/route.ts)** `TYPE_LABELS` — `trial_charge: "Пробное занятие"`.
5. **[timeline/route.ts:775-790](../../../app/src/app/api/clients/[id]/timeline/route.ts)** — ветка `trial_charge` → «Пробное занятие» (иначе сырой фолбэк `Операция (trial_charge)`).

### 4.3 Выручка / ОПИУ — включается автоматически

Движок ОПИУ/P&L/финрез/маржа/профит-инструктора/AI фильтрует по `attendanceType.countsAsRevenue:true` (у типа `present` дефолт true), а **не** по `isTrial`. Как только источник пишет `chargeAmount>0`, платные пробные попадают во все отчёты выручки. Бесплатные остаются 0 → не задваиваются (`buildCellRevenue` пропускает `amount===0`). **Правок в движке ноль.**

Предусловие: тип «Был» (present) не переопределён на `countsAsRevenue=false` в организации (дефолт ок).

**Полировка атрибуции:** [reports/finance/revenue/page.tsx:49](../../../app/src/app/(dashboard)/reports/finance/revenue/page.tsx) группирует по `subscription.direction` → у пробного нет абонемента → падает в «Без направления». Переключить на `lesson.group.direction`, чтобы выручка пробного шла под своё направление.

### 4.4 Прогноз прибыли (B1 / фикс A)

[profit-forecast/route.ts:35](../../../app/src/app/api/reports/profit-forecast/route.ts) строит базу выручки как `Σ subAmount` из [computeMonthSubscriptionFigures](../../../app/src/lib/finance/subscription-month-figures.ts) (только абонементы) → занижает прибыль на сумму пробных. Добавить в базу выручки прогноза реализованную выручку платных пробных за месяц: `Attendance` где `isTrial=true`, `chargeAmount>0`, `lesson.date` в месяце, филиальный scope по `lesson.group.branchId`. То же — в дашбордную карточку «Прогноз».

**НЕ трогаем** «Отработанные абонементы» и «Ожидаемые поступления»: по спеке Ани они абонементные (разовые там тоже исключены — это определение показателя, а не баг).

### 4.5 Клиентские метрики

- **[client-first-paid-lesson-date.ts](../../../app/src/lib/services/client-first-paid-lesson-date.ts)** — оставляем как есть (без `isTrial`-фильтра): пробные включаются в `firstPaidLessonDate` (решение «дата первой оплаты — да»).
- **[conversion-by-days/page.tsx:236,276](../../../app/src/app/(dashboard)/reports/crm/conversion-by-days/page.tsx)** — убрать `isTrial:false`, чтобы платное пробное считалось конверсией/продажей.
- **[new-client-income/route.ts](../../../app/src/app/api/reports/new-client-income/route.ts)** — добавить `isTrial:false` в сумму `chargeAmount` («остальное нет»).
- **[churn-by-months/route.ts:41](../../../app/src/app/api/reports/churn-by-months/route.ts)** — добавить `isTrial:false` в запрос `lastPaidLessons` («остальное нет»).
- Воронка [sales-funnel.ts](../../../app/src/lib/reports/sales-funnel.ts) считает по `firstPaidLessonDate` → пробные учтутся автоматически (решение «конверсии — да»). Правок не требует.

### 4.6 UI «Списание»

Без правок: колонка уже рендерит `chargeAmount` ([attendance-table.tsx:1126](../../../app/src/app/(dashboard)/schedule/lessons/[id]/attendance-table.tsx)). При `charge=1000` вместо 0/прочерка появится «1 000 ₽».

### 4.7 Документация/комментарии

- [trial-holder-lesson.ts:33](../../../app/src/lib/services/trial-holder-lesson.ts) — обновить док-комментарий «chargeAmount=0».
- [last-paid-lesson-date.ts:7-8](../../../app/src/lib/subscriptions/last-paid-lesson-date.ts) — устаревший комментарий «Пробные … chargeAmount = 0».
- PageHelp направления: пояснить, что «Стоимость пробного» списывается с баланса родителя, если пробное не бесплатное.

## 5. Что НЕ трогаем

- Движок ОПИУ/финрез (`api/reports/pnl`, `pnl-*`, `drill-down`, `pnl-*` либы, `instructor-profitability`, `ai-context`) — включают пробные сами.
- «Отработанные абонементы» / «Ожидаемые поступления» — абонементные по спеке (B1).
- Агрегаты закрытия абонементов (`subscription_closed_refund`, subscription-scoped) — `trial_charge` в них не попадает по построению.
- ДДС (`finance/dds`) — не читает ledger по типу.

## 6. Крайние случаи

- `trialFree=true` (или пустой `trialPrice`) → `charge=0`, поведение как сейчас.
- Дубли `TrialLesson` на одном занятии → attendance ключуется `(lesson, client, ward, isTrial)`; списание одно; при сбросе одного дубля с выжившим attended — списание сохраняем.
- Переключение флага «Оплата инструктору» на уже отмеченном пробном → идемпотентно (charge не двигается).
- Перенос/reschedule пробного → старое пробное отменяется (revert списания через ветку `cancelled`), новое спишет при отметке.
- FK `client_balance_transactions.attendance_id` — optional → при удалении attendance `SetNull`, возврат безопасен.

## 7. Тесты

- **unit** `computeTrialCharge` (trialFree / trialPrice → charge) — чистая, top-level (`test:unit`).
- **unit** [balance-debt-breakdown.test.ts](../../../app/src/__tests__/balance-debt-breakdown.test.ts) — кейс `trial_charge` (долг за пробное попадает в бакет «разовые», регрессия «невидимого долга» закрыта).
- **integration** (под `TEST_BASE_URL`): attended списывает `trialPrice`; сброс/`no_show`/`cancel` возвращает; повторный PATCH идемпотентен; `trialFree=true` не списывает; выручка ОПИУ растёт на сумму пробного; прогноз прибыли растёт.

## 8. Миграция / деплой

Prisma-миграция `ADD VALUE 'trial_charge'` + `npx prisma generate`. Локальной БД нет — миграцию катит CI на прод при деплое. После push проверить CI.
