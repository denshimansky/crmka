# Ограничение статусов «бывшего клиента»

**Дата:** 2026-07-31
**Автор:** Денис + Claude
**Статус:** проектирование

## Контекст и проблема

У клиента две оси статуса:

- **`funnelStatus`** (enum, всегда задан): `new` (Лид), `trial_scheduled`, `trial_attended`, `awaiting_payment`, `active_client`, `potential` (Потенциальный), `non_target` (Не целевой), `blacklisted` (ЧС), `archived` (Архив).
- **`clientStatus`** (work-status, nullable): `active`, `churned`, `null`.

Отображаемая метка (`lib/clients/state-label.ts`) считается по приоритету:
`archived > blacklisted > active > churned > non_target > potential > lead`.

**Реальный кейс** (клиент `fb7d302f-806b-4ed9-b363-1914fba23f15`, орг «Школа студия Class»): у клиента было платное разовое занятие (в долг) → система корректно перевела его в актив (`clientStatus=active`, `funnelStatus=active_client`, событие `paid_lesson` 28.07). Затем оператор вручную провёл его Активный → Выбывший → Лид → Потенциал → Не целевой → ЧС и обратно. Всплыли две проблемы:

1. **Из ЧС нельзя попасть в «Выбывшие».** При заносе в ЧС `clientStatus` обнуляется, клиент перестаёт быть «активным», карточка показывает селектор воронки (Лид/Потенциальный/Не целевой/ЧС/Архив), где «Выбывшие» нет вообще (`crm/_components/lead-status-actions.tsx`). «Выбывшие» предлагается только пока клиент активный.
2. **Бывшего клиента можно «уронить» в Потенциальный.** Гард «нельзя вернуть клиента в лида» (`api/clients/[id]/route.ts`) срабатывает только при `existing.clientStatus === "active"`. У выбывшего/занесённого в ЧС `clientStatus` уже не `active`, поэтому перевод в Потенциальный проходит.

## Цель

1. **Бывший клиент** (кто хоть раз был активным) **не может быть переведён в `Потенциальный`.** Лид и Не целевой — остаются разрешёнными (решение владельца).
2. **Бывший клиент может попасть в «Выбывшие» из любого статуса, включая ЧС/Архив, одной кнопкой** (право — owner/manager, как возврат из ЧС/Архива).

**Почему Лид/Не целевой можно, а Потенциальный нельзя:** Лид — у бывшего клиента появилась новая заявка/интерес (он снова заходит в воронку); Не целевой — сменились обстоятельства (например, переехал). Потенциальный = «тёплый, ещё не купил» — бессмысленно для того, кто уже покупал.

## Понятие «бывший клиент» (`wasEverClient`)

Клиент считается бывшим/текущим клиентом, если выполнено **любое**:

- `firstPaymentDate != null` (была оплата абонемента), **или**
- `firstPaidLessonDate != null` (было платное занятие, в т.ч. в долг), **или**
- `clientStatus ∈ {active, churned}` (сейчас активный/выбывший).

Признак **долгоживущий**: занос в ЧС/Архив обнуляет только `clientStatus`, а даты (`firstPaymentDate`, `firstPaidLessonDate`) остаются. Для кейс-клиента `firstPaidLessonDate = 2026-07-28` — предикат срабатывает.

**Выбор подхода:** предикат по существующим полям, **без миграции БД**. Альтернатива — отдельный durable-флаг `everActivated`, выставляемый при активации, — отклонена: требует миграции + бэкфилла + правки всех точек активации (`pay-from-balance`, `paid_lesson`, webhook ЮKassa, импорт), тогда как даты уже дают надёжный сигнал.

Реализация — единый хелпер `lib/clients/was-ever-client.ts`:

```ts
export function wasEverClient(c: {
  firstPaymentDate: Date | null
  firstPaidLessonDate: Date | null
  clientStatus: string | null
}): boolean {
  return (
    c.firstPaymentDate != null ||
    c.firstPaidLessonDate != null ||
    c.clientStatus === "active" ||
    c.clientStatus === "churned"
  )
}
```

Используется и на сервере (гарды), и на клиенте (селектор). На карточку `wasEverClient` приходит из серверного компонента (`client-card-content.tsx` уже грузит `firstPaymentDate`; добавить в выборку `firstPaidLessonDate`, если ещё нет).

## Правило 1 — запрет «Потенциального»

Сервер, `PATCH /api/clients/[id]`, после загрузки `existing`:

```ts
const wasClient = wasEverClient(existing)
if (wasClient && data.funnelStatus === "potential" && existing.funnelStatus !== "potential") {
  return 400 "Бывшего клиента нельзя вернуть в «Потенциальный»"
}
```

Условие `existing.funnelStatus !== "potential"` — чтобы no-op-сохранение уже-потенциального (легаси-рассинхрон) не падало, блокируем именно **переход в** `potential`. Enforced на сервере — единая точка правды, ловит и UI, и прямые вызовы API.

## Правило 2 — «В Выбывшие» из любого статуса

### Сервер

Перед существующими гардами вычисляем «выбытие из терминального статуса» и **инъектируем** возврат воронки, чтобы переиспользовать уже существующий role-gate и логику апдейта:

```ts
const churningFromTerminal =
  data.clientStatus === "churned" &&
  existing.clientStatus !== "churned" &&
  (existing.funnelStatus === "blacklisted" || existing.funnelStatus === "archived")

if (churningFromTerminal) {
  data.funnelStatus = "active_client" // выводим из ЧС/Архива, чтобы попал во вкладку «Выбывшие»
}
```

После инъекции работают существующие гарды **как есть**:

- **Role-gate** (существующий, строки ~110–121): `data.funnelStatus && data.funnelStatus !== existing.funnelStatus && existing ∈ {archived,blacklisted} && role ∉ {owner,manager}` → 403. Для owner/manager проходит. Т.е. право «вывести из ЧС/Архива» соблюдается автоматически.
- **Churned-gate** (существующий, строки ~125–145): нет активных абонементов → иначе 422. Сохраняется.
- Апдейт (`...(data.funnelStatus && { funnelStatus })`, `clientStatus`) выставит `funnelStatus=active_client` + `clientStatus=churned`.
- `recordClientStatusChange` залогирует `funnel: blacklisted→active_client`, `client: null→churned`, reason `manual`.

Итог: клиент виден во вкладке «Выбывшие» (метка `churned` бьёт `active_client`).

**Почему нужно менять воронку:** если оставить `funnelStatus=blacklisted` и просто выставить `clientStatus=churned`, метка «Чёрный список» (приоритет выше `churned`) перебьёт — клиент останется в ЧС. Поэтому «В Выбывшие» из ЧС именно **вытаскивает** из ЧС.

### Очистка `clientStatus` при переводе бывшего клиента в воронку

Чтобы Лид/Не целевой были видимы у **выбывшего** бывшего клиента (иначе метка `churned` перебьёт `non_target`/`lead`), расширяем существующую логику «сброса `clientStatus` при уходе в терминал» (`movingToArchived`) на переход бывшего клиента в **любой** воронковый бакет (`new`/`non_target`/`archived`/`blacklisted`), когда `clientStatus` не задаётся телом явно:

```ts
const movingToFunnelBucket =
  !!data.funnelStatus &&
  ["new", "non_target", "archived", "blacklisted"].includes(data.funnelStatus) &&
  data.clientStatus === undefined
// при movingToFunnelBucket → clientStatus: null
```

(Существующее поведение для archived/blacklisted — частный случай этого правила.)

### UI (`lead-status-actions.tsx`)

Новый проп `wasEverClient: boolean`. Три ветки селектора:

| Состояние клиента | Опции |
|---|---|
| **Активный сейчас** (`isActiveClient`) | без изменений: `В Выбывшие / В Архив / В ЧС` (+ `Вернуть в Активные`, если churned) |
| **Бывший клиент, сейчас не активный** (`wasEverClient && !isActiveClient`) | `В Выбывшие` (если ещё не churned) **или** `Вернуть в Активные` (если churned) · `Лид` · `Не целевой` · `Чёрный список` · `Архив`. **Без `Потенциального`.** |
| **Никогда не клиент** | без изменений: `Лид / Потенциальный / Не целевой / ЧС / Архив` |

Роутинг значения в тело PATCH (переиспользуем `handleActiveTransition`): `churned`/`active` → `{clientStatus}`, остальные → `{funnelStatus}`.

`currentBucketLabel` — без изменений (тот же приоритет, что у метки).

## Инварианты и крайние случаи

- **Текущий активный** — поведение прежнее.
- **Никогда-не-клиент (чистый лид)** — поведение прежнее, Потенциальный доступен.
- **Бывший выбывший** — доступны Лид / Не целевой / Архив / ЧС / Активные; **Потенциальный — нет**. При выборе Лид/Не целевой `clientStatus` очищается (клиент виден в выбранном бакете, метка `churned` больше не перебивает).
- **«В Выбывшие» из ЧС/Архива** — только owner/manager; переносит в `active_client` + `churned` → вкладка «Выбывшие».
- **Легаси-рассинхрон** (бывший клиент уже сидит в `potential`, как кейс-клиент) — не чиним ретроактивно; новое правило лишь запрещает будущие переходы **в** Потенциальный и даёт путь в Выбывшие.

## Тестирование

Дополнить `src/__tests__/funnel-lead-status.test.ts`:

- `wasEverClient`: комбинации `firstPaymentDate` / `firstPaidLessonDate` / `clientStatus`.
- Гард R1: бывший клиент → `potential` = 400; чистый лид → `potential` = OK; бывший клиент, уже `potential`, no-op = OK.
- Гард R2: `churned` из `blacklisted`/`archived` под owner/manager → `active_client`+`churned`; под админом → 403; churned-gate по активным абонементам сохраняется.
- Очистка `clientStatus` при переводе бывшего клиента в `new`/`non_target`.
- Селектор: набор опций для трёх веток (юнит на чистую функцию выбора опций, если выделим).

Ручная проверка на клиенте `fb7d302f` на msk1 после деплоя.

## Вне рамок

- Ретроактивная нормализация уже «неправильных» бывших клиентов в базе.
- Замечен возможный пре-существующий нюанс: гард «нельзя вернуть активного в воронку» (строка ~105) при `clientStatus === "active"` формально блокирует и `В Архив`/`В ЧС` из активного (когда `clientStatus` именно `active`, а не только по активному абонементу). Не трогаем в этой задаче — проверить отдельно.
