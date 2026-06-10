# Воронка продаж: переход с «по ребёнку» на «по заявке»

**Статус:** план, ожидает реализации
**Дата:** 2026-06-10
**Автор решения:** Анна/Дмитрий (продуктовое требование), реализация — Денис

## Проблема

Вкладки «Продажи» (Заявка / Пробное / Прошёл пробное / Ожидаем оплату) фильтруются
по **одному полю ребёнка** `Ward.salesStage`. Но заявки (`Application`) — это сущности
**на каждое направление**: у одного ребёнка их может быть несколько.

Следствия (баги):
1. При записи на пробное `Ward.salesStage='trial_scheduled'`, а остальные активные
   заявки ребёнка пропадают из «Заявки» (хотя они живые).
2. Отмена пробного может оставить ребёнка вне всех вкладок (откат `salesStage`
   пропускается при `remainingActive>0`), при этом заявка остаётся `active`.
3. В «Заявке» показывается только одна заявка ребёнка (`take:1`).
4. Перевод в «Ожидание оплаты» и оплата закрывают **все** активные заявки ребёнка.

## Целевая модель (требование заказчика)

**Воронка ведётся по заявке, а не по ребёнку.** Каждая `Application` — самостоятельная
единица со своим этапом. Сумма строк по всем вкладкам = число активных заявок.

Пример: у ребёнка 3 заявки на 3 направления →
- изначально: 3 строки в «Заявка»;
- по одной назначили пробное → 2 «Заявка» + 1 «Пробное»;
- другую без пробного перевели в ожидание оплаты → 1 «Заявка» + 1 «Пробное» + 1 «Ожидаем оплату».

Правила по краям (согласовано 2026-06-10):
- **Отмена** пробного (из любой точки, вкл. статус в занятии) → заявка возвращается в «Заявка».
- **«Не пришёл»** (no_show) → заявка **остаётся** на вкладке «Пробное» (не теряем ребёнка).
- **Оплата** одной заявки → уходит из воронки **только она**; остальные остаются.
- **Запись на пробное** всегда привязана к заявке (кнопка неактивна без активной заявки).

## Решение

### 1. Схема БД (Prisma) + миграция

- `Application.stage : WardSalesStage @default(application)` — переиспользуем существующий
  enum (`none` для активной заявки не используется; терминальность — через `status`).
- `Application.processedToStatus` — добавить значение `won` в enum `ApplicationOutcome`
  (оплата). `trial` становится legacy (этап, а не исход).
- `TrialLesson.applicationId : String? @db.Uuid` + relation — связь пробного с конкретной
  заявкой. Nullable: legacy-пробные без привязки.
- `Ward.salesStage` **сохраняем** как денормализованное зеркало = максимальный этап
  среди активных заявок ребёнка (приоритет: `awaiting_payment` > `trial_attended` >
  `trial_scheduled` > `application` > `none`). Это оставляет дашборд/отчёты/контакты/
  генерацию задач рабочими без переписывания.

**Бэкофилл** (TS-скрипт-миграция, данных мало — MVP):
- `TrialLesson.applicationId`: матчим по `tenantId+wardId+directionId` (или
  `group.directionId`) → активная заявка, иначе последняя.
- `Application.stage`: по умолчанию `application`. Для ward с не-`none` `salesStage`:
  - заявку, по которой было пробное (была помечена `processed/processedToStatus=trial`),
    **переоткрываем** (`status=active`, `stage=` по статусу пробного: scheduled/no_show →
    `trial_scheduled`, attended → `trial_attended`) и линкуем пробное;
  - для `awaiting_payment` с pending-абонементом — матчим заявку по направлению →
    `stage=awaiting_payment` (или создаём синтетическую из абонемента, если заявки нет).
- Спот-проверка после прогона: сумма по вкладкам == число активных заявок на тенант.

### 2. Общий помощник

`lib/services/ward-sales-stage.ts` →
`recomputeWardSalesStage(tx, tenantId, wardId)`:
читает активные заявки ward, ставит `Ward.salesStage` = макс. этап (или `none`),
обновляет `salesStageAt` при изменении. Вызывается после каждого перехода заявки.

### 3. Переходы (теперь по заявке)

| Действие | Файл | Было | Стало |
|---|---|---|---|
| Создать заявку | `api/applications/route.ts`, `clients/[id]/wards/route.ts` | ward→application | application: stage=application, status=active; recompute |
| Записать на пробное | `lib/services/trial-lesson.ts`, `applications/[id]/process`, `api/trial-lessons` POST, `trial-lesson-dialog.tsx` | app→processed(trial), ward→trial_scheduled | трибуем `applicationId`; trial.applicationId=app; app.stage=trial_scheduled (status active); recompute |
| Пробное «Пришёл» | `api/trial-lessons/[id]` PATCH attended | ward→trial_attended | linked app.stage=trial_attended; recompute |
| Пробное «Не пришёл» | `api/trial-lessons/[id]` PATCH no_show | — | app.stage без изменений (остаётся trial_scheduled → вкладка «Пробное») |
| Пробное «Отменить» | `api/trial-lessons/[id]` PATCH cancelled | откат ward (с багом) | linked app.stage=application; recompute (по заявке, надёжно) |
| В «Ожидание оплаты» | `move-to-awaiting-payment`, `awaiting-payment-dialog.tsx` | закрывал все заявки, ward→awaiting_payment | трибуем `applicationId`; **только эта** app.stage=awaiting_payment; siblings не трогаем; recompute |
| Оплата (выигрыш) | `lib/subscriptions/pay-from-balance.ts` | ward→none | матч заявки по wardId+directionId → status=processed, processedToStatus=won; recompute (ward остаётся в воронке, если есть др. активные) |
| Вывести из воронки (строка) | `sales-table.tsx` + новый `api/applications/[id]/remove-from-funnel` | per-ward remove-from-funnel | soft-delete **этой** заявки + отмена её пробного; recompute |

### 4. Страница «Продажи» (`crm/sales/page.tsx`) + counts

Все 4 вкладки — из `db.application.findMany({ status:'active', stage:<tab>, ... })`,
**одна строка на заявку**. Для trial/trial_done/awaiting подтягиваем связанные
`TrialLesson`(по `applicationId`) / `Subscription`(по wardId+directionId).
- Вкладка «Пробное»: показывать пробные со статусом `scheduled` **и** `no_show`.
- Счётчики = `application.count` по stage. Сумма вкладок = число активных заявок.
- `rowId = application.id`, `applicationId` проставлен всегда (Обработать/комментарий работают).

### 5. Контекстное меню строки (`sales-table.tsx`)

«Установить статус» → «Пробное записано»/«Ожидание оплаты» и «Удалить» работают
по `applicationId` строки (а не по `ward.id`). Диалоги (`TrialLessonDialog`,
`AwaitingPaymentDialog`) принимают и шлют `applicationId`.

### 6. Прочие читатели `Ward.salesStage` (через зеркало, без переписывания)

Дашборд-воронка, `reports/crm/funnel`, `reports/funnel`, `crm/contacts`
(`pickTopSalesStage`), `ward-sales-stage-actions`, `wards/[id]/page`,
`tasks/generate` (payment_due), `reports/capacity` — продолжают читать зеркало.
`api/sales/route.ts` — мёртвый дубликат (нет вызовов): обновить под новую модель
или удалить.

### 7. Тесты (Playwright)

Обновить/добавить:
- мульти-заявка видна целиком в «Продажах» (3 заявки = 3 строки);
- отмена пробного → заявка в «Заявка» (даже при наличии др. пробных);
- no_show → заявка остаётся в «Пробное»;
- оплата одной → остальные остаются в воронке;
- перевод в ожидание оплаты — только выбранная заявка.

### 8. Справка «?» (PageHelp)

Обновить текст `crm/sales` в `lib/page-help-content.ts` под модель «строка = заявка».

## Порядок реализации

1. Схема + миграция + бэкофилл-скрипт, прогон на dev.
2. `recomputeWardSalesStage` helper.
3. Переходы (trial-lesson service, trial-lessons routes, applications, awaiting-payment, pay-from-balance, applications create).
4. Страница Продаж + counts + контекстное меню + диалоги (`applicationId`).
5. Прочие читатели — проверить, что зеркало корректно (точечные правки при необходимости).
6. Тесты + PageHelp.
7. Push → проверить CI.
