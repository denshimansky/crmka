# Аудит мультитенантности — CRMka

**Дата:** 2026-04-08
**Версия:** v1.4.1-alpha
**Цель:** найти все проблемы изоляции данных между организациями (тенантами) при 3+ тенантах

---

## Executive Summary

| Severity | Count | Описание |
|----------|-------|----------|
| CRITICAL | 3 | Утечка данных между тенантами, обход авторизации |
| HIGH     | 12 | Операции без проверки tenantId — можно модифицировать чужие данные по UUID |
| MEDIUM   | 6 | Отсутствующие валидации, edge-case коллизии |
| LOW      | 4 | Архитектурные замечания, потенциальные проблемы при масштабировании |

**Вывод:** система НЕ готова к мультитенантности. Критические проблемы позволяют пользователю одного тенанта читать и модифицировать данные другого тенанта, зная UUID записей.

---

## CRITICAL

### C-1. Аутентификация: login без tenantId — коллизия логинов между организациями

**Файл:** `app/src/lib/auth.ts`, строки 24-34

```typescript
const employee = await db.employee.findFirst({
  where: {
    OR: [
      { login: credentials.login },
      { email: credentials.login },
    ],
    isActive: true,
    deletedAt: null,
  },
  include: { organization: true },
})
```

**Проблема:** `findFirst` без `tenantId`. Если в org A и org B есть сотрудник с логином `admin`, при входе система найдёт ПЕРВОГО ПО ПОРЯДКУ В БД. Сотрудник org B может случайно войти в org A (или наоборот).

**Вероятность:** 100% при типовых логинах (admin, director, anna).

**Fix:** На экране логина добавить поле "организация" (slug/subdomain/выбор), либо сделать логин глобально уникальным.

Рекомендуемый вариант — поддомены: `umndeti.app.umnayacrm.ru`. Тогда tenantId определяется по URL, и `findFirst` фильтрует по tenantId.

---

### C-2. Нет RLS на уровне БД — вся изоляция только в коде приложения

**Файл:** `app/prisma/schema.prisma`

**Проблема:** В CLAUDE.md и PRD указано "tenant_id + RLS", но фактически PostgreSQL RLS (Row Level Security) НЕ настроен. Вся изоляция реализована только через `where: { tenantId }` в каждом API-запросе.

Это означает:
- Любая пропущенная проверка tenantId = утечка данных
- Прямой доступ к БД (admin tool, migration script, debug) = доступ ко всем тенантам
- Один баг в одном route.ts = breach для всех тенантов

**Fix:** Включить PostgreSQL RLS. Для каждой tenant-scoped таблицы создать policy:
```sql
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clients
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```
Prisma перед каждым запросом должна выполнять `SET app.current_tenant_id = '<uuid>'`.

---

### C-3. Отсутствие проверки billingStatus=blocked на уровне middleware/API

**Файл:** `app/src/middleware.ts` (13 строк, только проверка JWT)

**Проблема:** Middleware проверяет только наличие JWT-сессии. Если организация заблокирована (`billingStatus = 'blocked'`), пользователи продолжают работать как обычно. billingStatus читается клиентом через `/api/billing-status` и показывается как плашка, но НИ ОДИН API endpoint не блокирует запросы.

Заблокированный тенант может:
- Создавать клиентов, оплаты, расходы
- Генерировать отчёты
- Делать всё то же, что и оплачивающий

**Fix:** В middleware или в helper-функцию `getSession()` добавить проверку:
```typescript
const org = await db.organization.findUnique({
  where: { id: session.user.tenantId },
  select: { billingStatus: true }
})
if (org?.billingStatus === 'blocked') {
  return NextResponse.json({ error: "Организация заблокирована" }, { status: 403 })
}
```
Кешировать статус в JWT token с коротким TTL.

---

## HIGH

### H-1. DELETE /api/clients/[id] — soft delete без tenantId

**Файл:** `app/src/app/api/clients/[id]/route.ts`, строки 100-103

```typescript
await db.client.update({
  where: { id },
  data: { deletedAt: new Date() },
})
```

**Проблема:** DELETE проверяет роль (owner/manager), но обновляет запись по `{ id }` без `tenantId`. Пользователь org A может удалить клиента org B, зная его UUID.

**Fix:** `where: { id, tenantId: session.user.tenantId }`

---

### H-2. PATCH /api/clients/[id] — update без tenantId в where

**Файл:** `app/src/app/api/clients/[id]/route.ts`, строки 67-87

Хотя `findFirst` проверяет tenantId (строка 58), последующий `update` использует `where: { id }`. Race condition: между findFirst и update запись может быть подменена (маловероятно, но принцип нарушен).

**Fix:** Использовать `where: { id, tenantId: session.user.tenantId }` или выполнять findFirst + update в транзакции.

---

### H-3. Rooms: PATCH и DELETE полностью без tenantId

**Файл:** `app/src/app/api/rooms/[id]/route.ts`, строки 28-51

```typescript
// PATCH — update without tenantId:
const room = await db.room.update({
  where: { id },
  data: parsed.data,
})

// DELETE — same:
await db.room.update({
  where: { id },
  data: { deletedAt: new Date() },
})
```

**Проблема:** Ни PATCH, ни DELETE не проверяют, что room принадлежит текущему тенанту. Можно изменить/удалить кабинет чужой организации по UUID.

**Fix:** Добавить `findFirst({ where: { id, tenantId } })` перед update, или использовать compound where.

---

### H-4. Directions: DELETE без tenantId

**Файл:** `app/src/app/api/directions/[id]/route.ts`, строка 45

```typescript
await db.direction.update({ where: { id }, data: { deletedAt: new Date() } })
```

PATCH проверяет через findFirst (строка 30), но DELETE — нет.

**Fix:** Добавить findFirst + проверку tenantId перед DELETE.

---

### H-5. Groups: PATCH и DELETE без tenantId в update

**Файл:** `app/src/app/api/groups/[id]/route.ts`, строки 56, 71

PATCH: `findFirst` проверяет tenantId, затем `update({ where: { id } })` — без tenantId.
DELETE: `update({ where: { id } })` — вообще без проверки tenantId.

**Fix:** Добавить tenantId в where для DELETE. Использовать транзакцию для PATCH.

---

### H-6. Tasks: DELETE без проверки tenantId

**Файл:** `app/src/app/api/tasks/[id]/route.ts`, строки 52-53

```typescript
await db.task.update({
  where: { id },
  data: { deletedAt: new Date() },
})
```

PATCH проверяет через `findFirst` (строка 14), но DELETE — нет. Можно удалить задачу чужого тенанта.

**Fix:** Добавить findFirst с tenantId перед DELETE.

---

### H-7. CallCampaign PATCH без tenantId

**Файл:** `app/src/app/api/call-campaigns/[id]/route.ts`, строки 27-29

```typescript
const campaign = await db.callCampaign.update({
  where: { id },
  data: { status: body.status },
})
```

GET проверяет tenantId (строка 13), но PATCH обновляет по `{ id }` без проверки.

**Fix:** Добавить findFirst с tenantId перед update.

---

### H-8. CallCampaignItem PATCH без проверки tenantId

**Файл:** `app/src/app/api/call-campaigns/[id]/items/route.ts`, строки 56-59

```typescript
const prev = await tx.callCampaignItem.findUnique({ where: { id: data.itemId } })
await tx.callCampaignItem.update({
  where: { id: data.itemId },
  ...
})
```

Нет проверки, что item принадлежит текущему тенанту.

**Fix:** findFirst с tenantId.

---

### H-9. SalaryPayment POST — accountId и employeeId не валидируются на принадлежность тенанту

**Файл:** `app/src/app/api/salary-payments/route.ts`, строки 72-99

При создании выплаты ЗП:
- `data.employeeId` принимается из тела запроса, но НЕ проверяется, что сотрудник принадлежит тенанту
- `data.accountId` — аналогично, финансовый счёт не проверяется

Можно: создать запись ЗП, привязанную к сотруднику чужого тенанта, и списать деньги со счёта чужого тенанта (строка 94: `where: { id: data.accountId }` без tenantId).

**Fix:** Добавить findFirst с tenantId для employeeId и accountId перед транзакцией.

---

### H-10. SalaryAdjustment POST — employeeId не валидируется

**Файл:** `app/src/app/api/salary-adjustments/route.ts`, строки 56-66

`data.employeeId` из тела запроса напрямую сохраняется без проверки принадлежности к тенанту.

**Fix:** Добавить проверку `db.employee.findFirst({ where: { id: data.employeeId, tenantId } })`.

---

### H-11. AccountOperation POST — fromAccountId/toAccountId не валидируются

**Файл:** `app/src/app/api/account-operations/route.ts`, строки 76-109

Создание операций между счетами: `fromAccountId` и `toAccountId` берутся из запроса, но не проверяется, что эти счета принадлежат текущему тенанту. Можно перевести деньги между счетами разных организаций.

**Fix:** Валидировать оба accountId через `findFirst({ where: { id, tenantId } })`.

---

### H-12. Portal /api/portal/data — findUnique клиента без tenantId

**Файл:** `app/src/app/api/portal/data/route.ts`, строка 14-15

```typescript
const client = await db.client.findUnique({
  where: { id: clientId },
  ...
})
```

Хотя `clientId` и `tenantId` берутся из JWT (безопасный источник), запрос к БД выполняется без `tenantId`. Если JWT скомпрометирован или портальный токен утёк — данные доступны без tenant-фильтра.

**Fix:** Заменить на `findFirst({ where: { id: clientId, tenantId } })`.

---

## MEDIUM

### M-1. User.email — глобально уникальный constraint

**Файл:** `app/prisma/schema.prisma`, строка 45

```prisma
email String? @unique
```

User.email — уникален глобально, а не per-tenant. Если владелец org A зарегистрирован с email `anna@example.com`, владелец org B не сможет использовать тот же email.

На практике таблица `users` сейчас не используется напрямую (авторизация через Employee), но constraint может мешать PrismaAdapter.

**Fix:** Убрать `@unique` с User.email (или сделать `@@unique([email, employeeId])`). Или удалить модель User если она не используется.

---

### M-2. Organization.inn — нет уникального constraint

**Файл:** `app/prisma/schema.prisma`, строка 76

```prisma
inn String?
```

Два разных тенанта могут иметь одинаковый ИНН. Это не баг мультитенантности, но может вызвать путаницу в биллинге и юридических вопросах.

**Fix:** Добавить `@@unique([inn])` (с фильтром на NOT NULL).

---

### M-3. Attendance: уникальный constraint без tenantId

**Файл:** `app/prisma/schema.prisma`, строка 652

```prisma
@@unique([lessonId, subscriptionId])
```

Constraint `[lessonId, subscriptionId]` не включает tenantId. Теоретически, если lessonId из org A и subscriptionId из org B попадут в одну запись (через баг), constraint не защитит.

FK-связи (Lesson, Subscription) косвенно защищают, но при отсутствии RLS это слабая защита.

**Fix:** Изменить на `@@unique([tenantId, lessonId, subscriptionId])`.

---

### M-4. EmployeeBranch — нет tenantId, кросс-тенантная связь возможна

**Файл:** `app/prisma/schema.prisma`, строки 427-436

```prisma
model EmployeeBranch {
  id         String @id @default(uuid()) @db.Uuid
  employeeId String @map("employee_id") @db.Uuid
  branchId   String @map("branch_id") @db.Uuid
  ...
  @@unique([employeeId, branchId])
}
```

Модель не содержит tenantId. Теоретически можно привязать сотрудника org A к филиалу org B. FK-связи защищают частично, но без tenantId в модели — нет прямой валидации.

**Fix:** Добавить tenantId в модель EmployeeBranch.

---

### M-5. Subscription PATCH и DELETE — update по { id } после findFirst

**Файл:** `app/src/app/api/subscriptions/[id]/route.ts`, строки 94, 121

Паттерн "findFirst с tenantId, затем update по { id }" повторяется. Это не race condition в строгом смысле (Prisma сериализует), но архитектурно неправильно — лучше использовать `where: { id, tenantId }` напрямую.

**Fix:** Prisma не поддерживает compound where в update для non-unique fields. Использовать `updateMany` с `where: { id, tenantId }` или оставить findFirst + update в одной транзакции.

---

### M-6. Admin seed endpoint доступен без авторизации при ALLOW_DESTRUCTIVE_API=true

**Файл:** `app/src/app/api/admin/seed/route.ts`

Endpoint `/api/admin/seed` на dev-сервере проверяет только наличие суперадмина. Если `ALLOW_DESTRUCTIVE_API=true` — никакой авторизации. Любой может вызвать seed, если знает URL dev-сервера.

**Fix:** Всегда требовать admin-сессию, даже для seed.

---

## LOW

### L-1. Нет rate limiting — один тенант может замедлить систему для всех

Отсутствует rate limiting как на уровне API, так и на уровне nginx. Один тенант может отправить 10000 запросов/сек и замедлить работу для всех остальных.

**Fix:** Добавить rate limiting per-tenant (по tenantId из JWT). Например, через middleware или nginx `limit_req_zone` по кастомному заголовку.

---

### L-2. Reset-DB удаляет ВСЕ тенанты

**Файл:** `app/src/app/api/admin/reset-db/route.ts`

`deleteMany()` без фильтра — удаляет все организации, всех клиентов, все данные. Для dev-среды допустимо, но опасно если ALLOW_DESTRUCTIVE_API случайно включён на prod.

**Fix:** Дополнительная проверка: `if (process.env.NODE_ENV === 'production') throw`.

---

### L-3. Нет изоляции файлов (будущее)

Сейчас файловые загрузки отсутствуют, но при добавлении (фото, документы) пути должны включать tenantId: `/uploads/{tenantId}/...`.

**Fix:** При реализации загрузки файлов — tenantId в путь.

---

### L-4. JWT не содержит billingStatus — лишний запрос к БД

Каждый запрос для проверки блокировки потребует обращения к таблице organizations. Эффективнее хранить billingStatus в JWT с коротким TTL (5 мин) и обновлять при изменении.

**Fix:** Добавить billingStatus в JWT callback, обновлять при /api/billing-status.

---

## Сводная таблица: все маршруты и статус tenant-изоляции

### Легенда:
- OK — tenantId проверяется корректно
- PARTIAL — findFirst проверяет, но update/delete без tenantId
- MISSING — tenantId не проверяется вообще
- N/A — маршрут не tenant-scoped (admin/billing/portal)

| Маршрут | GET | POST | PATCH | DELETE | Статус |
|---------|-----|------|-------|--------|--------|
| /api/clients | OK | OK | — | — | OK |
| /api/clients/[id] | OK | — | PARTIAL (H-2) | MISSING (H-1) | **FIX** |
| /api/clients/[id]/wards | — | OK | — | — | OK |
| /api/clients/[id]/portal-link | OK | OK | — | — | OK |
| /api/employees | OK | OK | — | — | OK |
| /api/employees/[id] | — | — | OK | OK | OK |
| /api/branches/[id] | — | — | OK | OK | OK |
| /api/rooms/[id] | — | — | MISSING (H-3) | MISSING (H-3) | **FIX** |
| /api/directions/[id] | — | — | PARTIAL | MISSING (H-4) | **FIX** |
| /api/groups | OK | OK | — | — | OK |
| /api/groups/[id] | OK | — | PARTIAL (H-5) | MISSING (H-5) | **FIX** |
| /api/groups/[id]/templates | — | — | OK (PUT) | — | OK |
| /api/groups/[id]/enrollments | OK | OK | — | — | OK |
| /api/groups/[id]/generate | — | OK | — | — | OK |
| /api/lessons/[id] | OK | — | OK | — | OK |
| /api/lessons/[id]/attendance | — | OK | — | — | OK |
| /api/subscriptions | OK | OK | — | — | OK |
| /api/subscriptions/[id] | OK | — | PARTIAL (M-5) | PARTIAL (M-5) | **FIX** |
| /api/payments | OK | OK | — | — | OK |
| /api/expenses | OK | OK | — | — | OK |
| /api/expenses/[id] | — | — | OK | OK | OK |
| /api/accounts/[id] | — | — | OK | OK | OK |
| /api/account-operations | OK | MISSING (H-11) | — | — | **FIX** |
| /api/salary-payments | OK | MISSING (H-9) | — | — | **FIX** |
| /api/salary-adjustments | OK | MISSING (H-10) | — | — | **FIX** |
| /api/tasks | OK | OK | — | — | OK |
| /api/tasks/[id] | — | — | OK | MISSING (H-6) | **FIX** |
| /api/call-campaigns | OK | OK | — | — | OK |
| /api/call-campaigns/[id] | OK | — | MISSING (H-7) | — | **FIX** |
| /api/call-campaigns/[id]/items | OK | — | MISSING (H-8) | — | **FIX** |
| /api/organization | OK | — | OK | — | OK |
| /api/billing | OK | — | — | — | OK |
| /api/billing-status | OK | — | — | — | OK |
| /api/portal/auth | OK | OK | — | OK | N/A |
| /api/portal/data | PARTIAL (H-12) | — | — | — | **FIX** |
| /api/portal/consent | — | OK | — | — | OK |
| /api/reports/* | OK (все через getReportContext) | — | — | — | OK |

---

## Рекомендуемый порядок исправлений

### Phase 1 — До пилота (критические, 1-2 дня):

1. **C-1:** Исправить авторизацию — добавить tenantId в поиск при логине (subdomain или login@orgslug)
2. **C-3:** Добавить проверку billingStatus в middleware/getSession()
3. **H-1..H-12:** Пройтись по всем маршрутам и добавить tenantId в where для update/delete

### Phase 2 — До MVP (1 неделя):

4. **C-2:** Реализовать PostgreSQL RLS как второй уровень защиты
5. **M-1..M-6:** Исправить unique constraints, добавить tenantId в EmployeeBranch
6. **L-1:** Rate limiting per-tenant

### Phase 3 — Post-MVP:

7. **L-2..L-4:** Hardening, файловая изоляция, оптимизация JWT

---

## Тестовый сценарий для верификации

Для проверки исправлений нужен тест с 2+ тенантами:

1. Создать org A и org B через бэк-офис
2. Создать owner в каждой с одинаковым логином (`admin`)
3. Проверить: вход под `admin` попадает в СВОЮ организацию
4. Из org A попытаться:
   - GET /api/clients/[uuid-from-org-B] — должен вернуть 404
   - DELETE /api/clients/[uuid-from-org-B] — должен вернуть 404
   - PATCH /api/rooms/[uuid-from-org-B] — должен вернуть 404
   - POST /api/salary-payments с employeeId из org B — должен вернуть 404
   - POST /api/account-operations с accountId из org B — должен вернуть 404
5. Заблокировать org A, проверить что все API возвращают 403
