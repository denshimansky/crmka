# Страница «Абонементы» (`/crm/subscriptions`) + массовая выписка

Дата: 2026-06-02. Автор: Денис.

## Контекст

В CRM нет отдельной плоской страницы со всеми абонементами центра. Абонементы видны
только внутри карточки клиента и в виджетах дашборда. Это плохо для оперативной
работы администратора: нельзя быстро найти все pending-абонементы за следующий
месяц, отфильтровать по филиалу/направлению, продлить группу абонементов
одной операцией.

Добавляем `/crm/subscriptions` — список со строкой = одним абонементом
(`Subscription`), тремя вкладками по статусу и кнопкой массовой выписки на
произвольный период.

## Маршрут и сайдбар

- URL: `/crm/subscriptions`.
- В [app/src/components/app-sidebar.tsx](app/src/components/app-sidebar.tsx),
  массив `crmItems`, добавляется пункт между «Дети» и «Обзвон»:
  - title: «Абонементы»,
  - href: `/crm/subscriptions`,
  - icon: `Ticket` (lucide; `Package` уже занят «Складом»),
  - permission: `clients.view`.

## Семантика вкладок

| Вкладка | `where.status` |
|---|---|
| Активные | `"active"` |
| Ожидающие оплаты | `"pending"` |
| Закончившиеся | `{ in: ["closed", "withdrawn"] }` |

`deletedAt = null` — везде.

В каждой вкладке — счётчик через отдельный `db.subscription.count`.

## Поиск, фильтры, сортировка

- `q` — токенизированный поиск (как в `crm/contacts/page.tsx`) по
  `ward.firstName/lastName`, `client.firstName/lastName`,
  нормализованному `client.phone`.
- Фильтр «Филиал» → `group.branchId = ...`.
- Фильтр «Направление» → `directionId = ...`.
- Оба фильтра — single-select с «Все» (значение `all`).
- Сортировка: `orderBy: { startDate: "desc" }` — общая для всех вкладок.

URL-параметры: `?tab=active|pending|finished&q=...&branch=<id>&direction=<id>`.

## Колонки таблицы

| Заголовок | Источник |
|---|---|
| ФИО ребёнка | `ward.lastName + ' ' + ward.firstName`; fallback на `client.lastName + ' ' + client.firstName`, если `ward = null` |
| Направление | `direction.name` |
| Филиал | `group.branch.name` |
| Группа | `group.name` |
| Сумма к оплате | `finalAmount`, формат «`N ₽`» |
| Оплачено | `chargedAmount`, формат «`N ₽`» |
| Срок | `DD.MM.YY – DD.MM.YY`; если `endDate = null` и есть `expiresAt` — `DD.MM.YY – DD.MM.YY (пакет)`; если оба null — `с DD.MM.YY` |
| Скидка | если у строки есть связанная запись `Discount` со ссылкой на шаблон → имя шаблона; иначе если `discountAmount > 0` → `−N ₽`; иначе `—` |

Связь `Discount → DiscountTemplate` в текущей схеме отсутствует. Колонка
строится так, чтобы при появлении связи (`Discount.templateId`)
изменения сводились к одному select-блоку. Пока показываем «−N ₽» для
всех ненулевых `discountAmount`.

Клик по строке → переход на `/crm/clients/[clientId]?tab=subscriptions` —
редактировать абонемент уже умеет карточка клиента.

## Кнопка «Выписать абонементы на следующий период»

Видна только на вкладке «Ожидающие оплаты», правый верх над таблицей.
Доступ — `owner` и `manager`.

Двухшаговый диалог:

### Шаг 1 — выбор периода

- Два date-input: «Начало периода», «Конец периода».
- По умолчанию: 1-е и последнее число следующего месяца от текущей даты.
- Чекбокс «Учитывать текущие фильтры таблицы (Филиал/Направление)» — по
  умолчанию включён.
- Кнопка «Превью».

### Шаг 2 — превью

POST `/api/subscriptions/bulk-renew/preview`. Сервер:

1. Берёт `Subscription` с `status = "active"`, `deletedAt = null`,
   опционально с фильтрами по `group.branchId` / `directionId`.
2. Группирует по ключу `(clientId, wardId, directionId, groupId)`.
   Если у одного клиента две активных строки с одним и тем же ключом —
   берётся последняя по `startDate` (защита от мусора).
3. Для каждой группы проверяет: нет ли уже `Subscription` с
   `status IN ("pending", "active")`, `deletedAt = null`, и пересечением
   периода `[startDate, COALESCE(endDate, expiresAt, startDate)]` с
   запрашиваемым `[rangeStart, rangeEnd]`. Если есть — `skip`-причина:
   «уже выписан на этот период».
4. Для оставшихся — считает `totalLessons` через новую функцию
   `countLessonsForGroup({ tenantId, groupId, rangeStart, rangeEnd })`
   — чистый подсчёт по `GroupScheduleTemplate` + производственному
   календарю, без записи в `Lesson` (выделяется как переиспользуемая
   утилита в `app/src/lib/schedule/count-lessons.ts`, общую дату-логику
   берёт из существующего `generate-group-lessons.ts`).
5. Возвращает `{ toCreate: Array<PreviewRow>, skipped: Array<SkipReason> }`.

В UI диалога: «Будет выписано N, пропущено M», раскрывающийся список
с deталями (ФИО ребёнка · Направление · Группа · занятий: K).
Внизу — кнопка «Подтвердить и выписать».

### Шаг 3 — коммит

POST `/api/subscriptions/bulk-renew` с теми же параметрами + `confirm: true`.
Сервер делает одну `db.$transaction`:

Для каждой `PreviewRow`:
- `lessonPrice` = `lessonPrice` исходного active-абонемента;
- `totalLessons` = посчитанные занятия;
- `totalAmount = lessonPrice × totalLessons`;
- `discountAmount = 0` (массовый перенос скидок — отдельная задача,
  см. брейнсторм скидок 2026-06-02);
- `finalAmount = totalAmount`;
- `balance = finalAmount` (ещё не оплачено);
- `chargedAmount = 0`;
- `status = "pending"`;
- `type = "calendar"` (массовая выписка — только для календарных);
- `periodYear/periodMonth` = `rangeStart.getFullYear()/getMonth()+1`;
- `previousSubscriptionId` = id исходного active-абонемента;
- `createdBy` = текущий employeeId.

После `create` — `applyBalanceDelta(tx, { ..., type: "subscription_issued",
delta: -finalAmount, subscriptionId, comment: "Массовая выписка на период
DD.MM.YY – DD.MM.YY" })` — как в одиночном `POST /api/subscriptions`.

Возвращает `{ created: N }`. Клиент делает `router.refresh()`.

## PageHelp

Новый ключ `crm/subscriptions` в
[app/src/lib/page-help-content.ts](app/src/lib/page-help-content.ts):
вкладки, столбцы, фильтры, кнопка массовой выписки.

## Файлы

Новые:

- `app/src/app/(dashboard)/crm/subscriptions/page.tsx` — server, запросы и render.
- `app/src/app/(dashboard)/crm/subscriptions/subscriptions-table.tsx` — клиент:
  табы, поиск, фильтры, таблица.
- `app/src/app/(dashboard)/crm/subscriptions/renew-button.tsx` — клиент:
  кнопка + двухшаговый диалог.
- `app/src/app/api/subscriptions/bulk-renew/preview/route.ts`.
- `app/src/app/api/subscriptions/bulk-renew/route.ts`.
- `app/src/lib/subscriptions/bulk-renew.ts` — общая логика preview/commit.
- `app/src/lib/schedule/count-lessons.ts` — чистый подсчёт занятий по
  расписанию за период (без записи в `Lesson`).

Правки:

- `app/src/components/app-sidebar.tsx` — добавить пункт «Абонементы».
- `app/src/lib/page-help-content.ts` — добавить раздел `crm/subscriptions`.

## Что НЕ делаем сейчас

- Автоперенос скидок при выписке — часть отложенной фичи скидок.
- Cron для автоматической выписки 1-го числа.
- Экспорт, чекбоксы для bulk-удаления, inline-редактирование.
- Pagination beyond default (Prisma вернёт всё; если строк станет много —
  добавим limit/offset в отдельной задаче).
- Массовая выписка для package/fixed абонементов — только календарные.

## Верификация

1. `pnpm dev` в `app/`. Войти владельцем.
2. В сайдбаре виден пункт «Абонементы» между «Дети» и «Обзвон».
3. `/crm/subscriptions?tab=active` показывает все active-абоны, счётчик
   совпадает с виджетом «Активные абонементы» на дашборде (с поправкой
   что дашборд = active + pending, а здесь только active).
4. Поиск по фамилии ребёнка/родителя и телефону работает (debounce 350 мс).
5. Селекты «Филиал», «Направление» фильтруют срез.
6. Сортировка по `startDate desc` — новые сверху.
7. На вкладке «Ожидающие оплаты» кнопка «Выписать на следующий период»:
   - дефолтные даты — 1-е и последнее число следующего месяца;
   - превью показывает корректное число строк к созданию и пропуски;
   - подтверждение создаёт pending-строки, они тут же появляются в списке;
   - повторное нажатие с тем же периодом → 0 созданных (все пропущены).
8. Проверить карточку клиента: новые pending-строки видны во вкладке
   «Абонементы» как обычно.
9. `applyBalanceDelta` создал `ClientBalanceTransaction` типа
   `subscription_issued` — баланс клиента ушёл в минус на сумму
   выписки. ДДС не задет (`Payment` не создаётся).
