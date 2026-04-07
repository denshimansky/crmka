# API-документация CRMka

> Автоматически сгенерировано на основе route-файлов. Дата: 2026-04-07.

Базовый URL: `/api`

## Содержание

- [Авторизация (Auth)](#авторизация-auth)
- [Организация (Organization)](#организация-organization)
- [Филиалы (Branches)](#филиалы-branches)
- [Кабинеты (Rooms)](#кабинеты-rooms)
- [Сотрудники (Employees)](#сотрудники-employees)
- [Направления (Directions)](#направления-directions)
- [Клиенты (Clients)](#клиенты-clients)
- [Подопечные (Wards)](#подопечные-wards)
- [Группы (Groups)](#группы-groups)
- [Шаблоны расписания (Schedule Templates)](#шаблоны-расписания-schedule-templates)
- [Занятия (Lessons)](#занятия-lessons)
- [Посещаемость (Attendance)](#посещаемость-attendance)
- [Абонементы (Subscriptions)](#абонементы-subscriptions)
- [Оплаты (Payments)](#оплаты-payments)
- [Финансовые счета (Accounts)](#финансовые-счета-accounts)
- [Операции между счетами (Account Operations)](#операции-между-счетами-account-operations)
- [Расходы (Expenses)](#расходы-expenses)
- [Категории расходов (Expense Categories)](#категории-расходов-expense-categories)
- [Зарплата — корректировки (Salary Adjustments)](#зарплата--корректировки-salary-adjustments)
- [Зарплата — выплаты (Salary Payments)](#зарплата--выплаты-salary-payments)
- [Периоды (Periods)](#периоды-periods)
- [Аудит (Audit Log)](#аудит-audit-log)
- [Задачи (Tasks)](#задачи-tasks)
- [Кампании обзвона (Call Campaigns)](#кампании-обзвона-call-campaigns)
- [Биллинг — статус (Billing Status)](#биллинг--статус-billing-status)
- [Биллинг — ЛК партнёра (Billing)](#биллинг--лк-партнёра-billing)
- [Портал клиента (Portal)](#портал-клиента-portal)
- [Бэк-офис — Авторизация (Admin Auth)](#бэк-офис--авторизация-admin-auth)
- [Бэк-офис — Партнёры (Admin Partners)](#бэк-офис--партнёры-admin-partners)
- [Бэк-офис — Тарифы (Admin Plans)](#бэк-офис--тарифы-admin-plans)
- [Бэк-офис — Подписки (Admin Subscriptions)](#бэк-офис--подписки-admin-subscriptions)
- [Бэк-офис — Счета (Admin Invoices)](#бэк-офис--счета-admin-invoices)
- [Бэк-офис — Служебные (Admin Seed / Reset)](#бэк-офис--служебные-admin-seed--reset)

---

## Общие принципы

- **Авторизация CRM:** NextAuth JWT-сессия (cookie `next-auth.session-token`). Сессия содержит `tenantId`, `employeeId`, `role`.
- **Авторизация Admin:** JWT в cookie `admin-token`. Роли: `superadmin`, `billing`.
- **Авторизация Portal:** JWT в cookie `portal-token`. Требуется согласие ПДн.
- **Мультитенантность:** все CRM-эндпоинты автоматически фильтруют по `tenantId` из сессии.
- **Soft delete:** большинство DELETE-операций устанавливают `deletedAt`, а не удаляют записи.
- **Проверка периода:** финансовые операции проверяют закрытие периода (`isPeriodLocked`).
- **Аудит:** финансовые операции логируются в `AuditLog`.

### Роли CRM

| Роль | Описание |
|------|----------|
| `owner` | Владелец организации — полный доступ |
| `manager` | Управляющий — настраиваемые права, близкие к owner |
| `admin` | Администратор — работа с клиентами, расписанием, оплатами |
| `instructor` | Инструктор/педагог — ограниченный доступ |
| `readonly` | Только просмотр |

---

## Авторизация (Auth)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET/POST | `/api/auth/[...nextauth]` | Нет | NextAuth — логин по логину/паролю, проверка сессии, callback'и |

**Логин:** `POST /api/auth/callback/credentials` с телом `{ login, password }`.

---

## Организация (Organization)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/organization` | Да, любая роль | Получить данные организации (включая филиалы, кабинеты, кол-во сотрудников) |
| PATCH | `/api/organization` | owner, manager | Обновить настройки организации |

**PATCH body:**
```
{
  name?: string,
  legalName?: string,
  inn?: string,
  phone?: string,
  email?: string,            // валидный email
  salaryDay1?: number,       // 1–28
  salaryDay2?: number,       // 1–31
  payForAbsence?: boolean,
  attendanceDeadline?: number, // 1–90 (дней)
  roleDisplayNames?: Record<string, string>
}
```

---

## Филиалы (Branches)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/branches` | Да, любая роль | Список филиалов (с кабинетами) |
| POST | `/api/branches` | owner, manager | Создать филиал |
| PATCH | `/api/branches/[id]` | owner, manager | Обновить филиал |
| DELETE | `/api/branches/[id]` | owner, manager | Удалить филиал (soft delete) |

**POST body:**
```
{
  name: string,              // обязательно
  address?: string,
  workingHoursStart?: string,
  workingHoursEnd?: string
}
```

---

## Кабинеты (Rooms)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/rooms` | Да, любая роль | Список кабинетов (с филиалом) |
| POST | `/api/rooms` | owner, manager | Создать кабинет |
| PATCH | `/api/rooms/[id]` | owner, manager | Обновить кабинет |
| DELETE | `/api/rooms/[id]` | owner, manager | Удалить кабинет (soft delete) |

**POST body:**
```
{
  name: string,        // обязательно
  branchId: string,    // UUID, обязательно
  capacity?: number    // default: 15, min: 1
}
```

---

## Сотрудники (Employees)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/employees` | Да, любая роль | Список сотрудников (с филиалами, ставками) |
| POST | `/api/employees` | owner, manager | Создать сотрудника |
| PATCH | `/api/employees/[id]` | owner, manager | Обновить сотрудника (включая пароль, филиалы) |
| DELETE | `/api/employees/[id]` | owner | Удалить сотрудника (soft delete). Владельца удалить нельзя |

**POST body:**
```
{
  login: string,           // латиница, цифры, точка, дефис, подчёркивание; min 2
  password: string,        // min 6
  firstName: string,
  lastName: string,
  middleName?: string,
  email?: string,
  phone?: string,
  birthDate?: string,      // ISO date
  role: "manager" | "admin" | "instructor" | "readonly",
  branchIds?: string[]     // UUID[]
}
```

---

## Направления (Directions)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/directions` | Да, любая роль | Список направлений |
| POST | `/api/directions` | owner, manager | Создать направление |
| PATCH | `/api/directions/[id]` | owner, manager | Обновить направление |
| DELETE | `/api/directions/[id]` | owner, manager | Удалить направление (soft delete) |

**POST body:**
```
{
  name: string,
  lessonPrice: number,       // min: 0
  lessonDuration?: number,   // min: 15, max: 480, default: 45 (минуты)
  trialPrice?: number,
  trialFree?: boolean,       // default: false
  color?: string
}
```

---

## Клиенты (Clients)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/clients` | Да, любая роль | Список клиентов (фильтры: status, search, segment, branchId) |
| POST | `/api/clients` | Да, любая роль | Создать клиента/лида (с подопечными) |
| GET | `/api/clients/[id]` | Да, любая роль | Карточка клиента (с подопечными, филиалом) |
| PATCH | `/api/clients/[id]` | Да, любая роль | Обновить клиента |
| DELETE | `/api/clients/[id]` | owner, manager | Удалить клиента (soft delete) |

**GET query params:**
- `status` — `active`, `lead`, `churned`, `all`
- `search` — поиск по имени, фамилии, телефону, email
- `segment` — сегмент клиента
- `branchId` — UUID филиала

**POST body:**
```
{
  firstName?: string,
  lastName?: string,
  patronymic?: string,
  phone?: string,            // обязательно phone ИЛИ socialLink
  phone2?: string,
  email?: string,
  socialLink?: string,
  funnelStatus?: string,     // default: "new"
  clientStatus?: string | null,
  branchId?: string,
  assignedTo?: string,
  comment?: string,
  nextContactDate?: string,
  wards?: Array<{
    firstName: string,
    lastName?: string,
    birthDate?: string,
    notes?: string
  }>
}
```

**Воронка (funnelStatus):** `new`, `trial_scheduled`, `trial_attended`, `awaiting_payment`, `active_client`, `potential`, `non_target`, `blacklisted`, `archived`

**Статус клиента (clientStatus):** `active`, `upsell`, `churned`, `returning`, `archived`

---

## Подопечные (Wards)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| POST | `/api/clients/[id]/wards` | Да, любая роль | Добавить подопечного клиенту |

**POST body:**
```
{
  firstName: string,
  lastName?: string,
  birthDate?: string,  // ISO date
  notes?: string
}
```

---

## Ссылка на портал клиента

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/clients/[id]/portal-link` | Да, любая роль | Получить текущую ссылку на ЛК клиента |
| POST | `/api/clients/[id]/portal-link` | Да, любая роль | Сгенерировать новую ссылку (деактивирует старые) |

**Ответ POST:** `{ link: string, token: string }`

---

## Группы (Groups)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/groups` | Да, любая роль | Список групп (с направлением, филиалом, шаблонами, кол-вом учеников) |
| POST | `/api/groups` | Да, любая роль | Создать группу (с шаблонами расписания) |
| GET | `/api/groups/[id]` | Да, любая роль | Карточка группы (с зачислениями, шаблонами) |
| PATCH | `/api/groups/[id]` | owner, manager | Обновить группу |
| DELETE | `/api/groups/[id]` | owner, manager | Удалить группу (soft delete) |

**POST body:**
```
{
  name: string,
  directionId: string,     // UUID
  branchId: string,        // UUID
  roomId: string,          // UUID
  instructorId: string,    // UUID
  maxStudents?: number,    // default: 15
  templates?: Array<{
    dayOfWeek: number,     // 0=Пн, 6=Вс
    startTime: string,     // "HH:MM"
    durationMinutes: number
  }>
}
```

### Зачисления в группу (Enrollments)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/groups/[id]/enrollments` | Да, любая роль | Список зачислений группы |
| POST | `/api/groups/[id]/enrollments` | Да, любая роль | Зачислить ученика |

**POST body:**
```
{
  clientId: string,        // UUID
  wardId?: string | null,  // UUID
  selectedDays?: number[]  // дни недели
}
```

### Генерация занятий

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| POST | `/api/groups/[id]/generate` | Да, любая роль | Сгенерировать занятия по шаблонам на месяц |

**POST body:**
```
{
  month: number,  // 1–12
  year: number    // 2024–2030
}
```

**Ответ:** `{ created: number, message: string }`

---

## Шаблоны расписания (Schedule Templates)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| PUT | `/api/groups/[id]/templates` | owner, manager | Полная перезапись шаблонов расписания группы |

**PUT body:**
```
{
  templates: Array<{
    dayOfWeek: number,       // 0–6
    startTime: string,       // "HH:MM"
    durationMinutes: number  // 5–480
  }>
}
```

---

## Занятия (Lessons)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/lessons/[id]` | Да, любая роль | Карточка занятия (ученики, посещения, абонементы, ставки ЗП, типы посещений) |
| PATCH | `/api/lessons/[id]` | Да, любая роль | Обновить занятие (тема, ДЗ, статус, причина отмены) |

**PATCH body:**
```
{
  topic?: string | null,
  homework?: string | null,
  status?: "scheduled" | "completed" | "cancelled",
  cancelReason?: string | null
}
```

---

## Посещаемость (Attendance)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| POST | `/api/lessons/[id]/attendance` | Да, любая роль | Отметить посещение ученика (upsert). Автоматически списывает с абонемента, начисляет ЗП инструктору, конвертирует лида в клиента |
| PUT | `/api/lessons/[id]/attendance` | Да, любая роль | Массовая отметка всех зачисленных учеников |

**POST body:**
```
{
  clientId: string,          // UUID
  wardId?: string | null,
  subscriptionId?: string | null,
  attendanceTypeId: string,  // UUID
  instructorPayEnabled?: boolean  // default: true
}
```

**PUT body (bulk):**
```
{
  attendanceTypeId: string   // UUID — применяется ко всем ученикам
}
```

**Типы посещений (системные):**

| Код | Название | Списывает абонемент | ЗП инструктору | Считается выручкой |
|-----|----------|--------------------|-----------------|--------------------|
| `present` | Явка | Да | Да | Да |
| `absent` | Прогул | Да | Нет | Нет |
| `recalc` | Перерасчёт | Нет | Нет | Нет |
| `makeup` | Отработка | Да | Да | Да |
| `trial` | Пробное | Нет | Да | Нет |

---

## Абонементы (Subscriptions)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/subscriptions` | Да, любая роль | Список абонементов (фильтры: clientId, status, periodYear, periodMonth) |
| POST | `/api/subscriptions` | Да, любая роль | Создать абонемент |
| GET | `/api/subscriptions/[id]` | Да, любая роль | Карточка абонемента (с оплатами, скидками) |
| PATCH | `/api/subscriptions/[id]` | Да, любая роль | Обновить абонемент (статус, цена, кол-во занятий, скидка) |
| DELETE | `/api/subscriptions/[id]` | owner, manager | Удалить абонемент (soft delete) |

**POST body:**
```
{
  clientId: string,
  directionId: string,
  groupId: string,
  periodYear: number,        // 2020–2100
  periodMonth: number,       // 1–12
  lessonPrice: number,
  totalLessons: number,      // min: 1
  wardId?: string,
  startDate?: string,        // ISO date, default: 1-е число месяца
  discountAmount?: number    // default: 0
}
```

**Статусы абонемента:** `pending`, `active`, `closed`, `withdrawn`

---

## Оплаты (Payments)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/payments` | Да, любая роль | Список оплат (фильтры: clientId, dateFrom, dateTo, method) |
| POST | `/api/payments` | owner, manager, admin | Создать оплату. Обновляет баланс счёта, баланс клиента, активирует абонемент. Первая оплата конвертирует лида в клиента |

**POST body:**
```
{
  clientId: string,
  accountId: string,
  amount: number,            // min: 0.01
  method: "cash" | "bank_transfer" | "acquiring" | "online_yukassa" | "online_robokassa" | "sbp_qr",
  date: string,              // ISO date
  subscriptionId?: string,
  comment?: string
}
```

---

## Финансовые счета (Accounts)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/accounts` | Да, любая роль | Список счетов (с филиалами) |
| POST | `/api/accounts` | Да, любая роль | Создать счёт |
| PATCH | `/api/accounts/[id]` | Да, любая роль | Обновить счёт |
| DELETE | `/api/accounts/[id]` | owner, manager | Удалить счёт (soft delete) |

**POST body:**
```
{
  name: string,
  type: "cash" | "bank_account" | "acquiring" | "online",
  branchId?: string
}
```

---

## Операции между счетами (Account Operations)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/account-operations` | Да, любая роль | Список операций (фильтры: dateFrom, dateTo) |
| POST | `/api/account-operations` | Да, любая роль | Создать операцию (выемка, инкассация, перевод). Автоматически обновляет балансы счетов |

**POST body:**
```
{
  type: "owner_withdrawal" | "encashment" | "transfer",
  fromAccountId?: string,    // обязательно для withdrawal/encashment/transfer
  toAccountId?: string,      // обязательно для transfer
  amount: number,            // min: 0.01
  date: string,
  description?: string
}
```

---

## Расходы (Expenses)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/expenses` | Да, любая роль | Список расходов (фильтры: dateFrom, dateTo, categoryId, branchId, accountId) |
| POST | `/api/expenses` | Да, любая роль | Создать расход. Списывает со счёта, проверяет закрытие периода |
| PATCH | `/api/expenses/[id]` | Да, любая роль | Обновить расход (пересчитывает балансы при смене суммы/счёта) |
| DELETE | `/api/expenses/[id]` | Да, любая роль | Удалить расход (soft delete, возвращает сумму на счёт) |
| POST | `/api/expenses/copy-month` | Да, любая роль | Скопировать повторяющиеся расходы из одного месяца в другой |

**POST body (создание):**
```
{
  categoryId: string,
  accountId: string,
  amount: number,            // min: 0.01
  date: string,
  comment?: string,
  isVariable?: boolean,
  isRecurring?: boolean,     // default: false
  amortizationMonths?: number,
  branchIds?: string[]       // UUID[]
}
```

**POST body (copy-month):**
```
{
  sourceYear: number,
  sourceMonth: number,       // 1–12
  targetYear: number,
  targetMonth: number        // 1–12
}
```

---

## Категории расходов (Expense Categories)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/expense-categories` | Да, любая роль | Системные + пользовательские категории расходов |

14 системных категорий: Аренда, Коммунальные, Интернет, Канцтовары, Учебные материалы, Хозтовары, Реклама, Ремонт, Оборудование, Налоги, Банковское обслуживание, Транспорт, Питание, Прочее.

---

## Зарплата — корректировки (Salary Adjustments)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/salary-adjustments` | Да, любая роль | Список корректировок (фильтры: periodYear, periodMonth, employeeId) |
| POST | `/api/salary-adjustments` | Да, любая роль | Создать корректировку (бонус или штраф) |

**POST body:**
```
{
  employeeId: string,
  type: "bonus" | "penalty",
  amount: number,            // min: 0.01
  periodYear: number,
  periodMonth: number,       // 1–12
  comment: string            // обязательно
}
```

---

## Зарплата — выплаты (Salary Payments)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/salary-payments` | Да, любая роль | Список выплат (фильтры: periodYear, periodMonth, employeeId) |
| POST | `/api/salary-payments` | owner, manager | Создать выплату. Списывает со счёта, проверяет закрытие периода |

**POST body:**
```
{
  employeeId: string,
  accountId: string,
  amount: number,
  date: string,
  periodYear: number,
  periodMonth: number,
  periodHalf?: 1 | 2,       // половина месяца (аванс/расчёт)
  comment?: string
}
```

---

## Периоды (Periods)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/periods` | Да, любая роль | Список периодов организации |
| POST | `/api/periods` | owner, manager (reopen — только owner) | Закрыть или переоткрыть период |

**POST body:**
```
{
  year: number,
  month: number,             // 1–12
  action: "close" | "reopen",
  comment?: string
}
```

Закрытый период блокирует создание/изменение оплат, расходов, посещений за этот месяц (кроме owner/manager).

---

## Аудит (Audit Log)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/audit` | owner | Журнал действий с пагинацией |

**Query params:**
- `entityType` — тип сущности (Payment, Expense, Attendance, SalaryPayment, AccountOperation)
- `entityId` — UUID сущности
- `employeeId` — UUID сотрудника
- `dateFrom`, `dateTo` — фильтр по дате
- `page` — номер страницы (default: 1)
- `limit` — записей на страницу (default: 50, max: 100)

**Ответ:** `{ logs: AuditLog[], total: number, page: number, limit: number }`

---

## Задачи (Tasks)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/tasks` | Да, любая роль | Список задач (фильтр: status, default: pending) |
| POST | `/api/tasks` | Да, любая роль | Создать задачу вручную |
| PATCH | `/api/tasks/[id]` | Да, любая роль | Обновить задачу (статус, заголовок, дату, исполнителя) |
| DELETE | `/api/tasks/[id]` | Да, любая роль | Удалить задачу (soft delete) |
| POST | `/api/tasks/generate` | Да, любая роль | Сгенерировать автозадачи на сегодня |

**POST body (создание):**
```
{
  title: string,
  description?: string,
  assignedTo: string,        // UUID сотрудника
  dueDate: string,
  clientId?: string
}
```

**Автозадачи (5 триггеров):**
1. `contact_date` — дата следующего контакта = сегодня
2. `promised_payment` — обещанная дата оплаты = сегодня (при отрицательном балансе)
3. `birthday` — день рождения подопечного
4. `unmarked_lesson` — неотмеченные занятия вчера
5. `payment_due` — ожидание оплаты > 3 дней

---

## Кампании обзвона (Call Campaigns)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/call-campaigns` | Да, любая роль | Список кампаний (до 50) |
| POST | `/api/call-campaigns` | Да, любая роль | Создать кампанию (автоматически формирует список клиентов по фильтру) |
| GET | `/api/call-campaigns/[id]` | Да, любая роль | Карточка кампании |
| PATCH | `/api/call-campaigns/[id]` | Да, любая роль | Обновить статус кампании |
| GET | `/api/call-campaigns/[id]/items` | Да, любая роль | Список контактов кампании (фильтр: all, pending, completed) |
| PATCH | `/api/call-campaigns/[id]/items` | Да, любая роль | Обновить результат звонка |

**POST body (создание):**
```
{
  name: string,
  filterCriteria?: {
    funnelStatus?: string,
    branchId?: string,
    segment?: string
  }
}
```

**PATCH body (результат звонка):**
```
{
  itemId: string,            // UUID элемента кампании
  status: "called" | "no_answer" | "callback" | "completed",
  result?: string,
  comment?: string
}
```

---

## Биллинг — статус (Billing Status)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/billing-status` | Да, любая роль | Статус биллинга текущей организации (для плашек) |

**Ответ:** `{ billingStatus: "active" | "grace_period" | "blocked", daysUntilPayment?: number }`

---

## Биллинг — ЛК партнёра (Billing)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/billing` | owner, manager | Полная информация о подписке организации (план, счета, статистика) |
| GET | `/api/billing/invoices` | owner, manager | Список счетов текущей организации |

---

## Портал клиента (Portal)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| POST | `/api/portal/auth?token=xxx` | Нет (токен в URL) | Авторизация клиента по токену. Устанавливает cookie |
| GET | `/api/portal/auth` | Portal JWT | Проверка сессии портала |
| DELETE | `/api/portal/auth` | Portal JWT | Выход из портала |
| POST | `/api/portal/consent` | Portal JWT | Согласие на обработку ПДн |
| GET | `/api/portal/data` | Portal JWT + ПДн | Все данные клиента: профиль, подопечные, абонементы, оплаты, расписание на 2 недели |

---

## Бэк-офис — Авторизация (Admin Auth)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| POST | `/api/admin/auth` | Нет (rate limit: 5/мин per IP) | Логин суперадмина (email + пароль) |
| GET | `/api/admin/auth` | Admin JWT | Проверка сессии |
| DELETE | `/api/admin/auth` | Admin JWT | Выход |

**POST body:** `{ email: string, password: string }`

---

## Бэк-офис — Партнёры (Admin Partners)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/admin/partners` | Admin JWT | Список партнёров (организаций) со статистикой |
| POST | `/api/admin/partners` | superadmin, billing | Создать партнёра (+ опционально owner + подписку на дефолтный тариф) |
| GET | `/api/admin/partners/[id]` | Admin JWT | Карточка партнёра (филиалы, сотрудники, подписки, счета) |
| PATCH | `/api/admin/partners/[id]` | superadmin, billing | Обновить данные партнёра (включая billingStatus) |

**POST body (создание):**
```
{
  name: string,
  legalName?: string,
  inn?: string,
  phone?: string,
  email?: string,
  contactPerson?: string,
  ownerFirstName?: string,   // все 4 поля owner — или все, или ничего
  ownerLastName?: string,
  ownerLogin?: string,
  ownerPassword?: string,
  ownerEmail?: string
}
```

---

## Бэк-офис — Тарифы (Admin Plans)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/admin/plans` | Admin JWT | Список тарифных планов (с кол-вом подписок) |
| POST | `/api/admin/plans` | superadmin | Создать тарифный план |
| PATCH | `/api/admin/plans/[id]` | superadmin | Обновить тарифный план |
| DELETE | `/api/admin/plans/[id]` | superadmin | Деактивировать план (isActive = false) |

**POST body:**
```
{
  name: string,
  pricePerBranch: number,    // min: 0
  description?: string
}
```

---

## Бэк-офис — Подписки (Admin Subscriptions)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/admin/subscriptions` | Admin JWT | Все подписки (с организацией, планом) |
| POST | `/api/admin/subscriptions` | superadmin, billing | Создать подписку. Активирует организацию |
| PATCH | `/api/admin/subscriptions/[id]` | superadmin, billing | Обновить подписку (статус, кол-во филиалов, план). Синхронизирует billingStatus организации |

**POST body:**
```
{
  organizationId: string,    // UUID
  planId: string,            // UUID
  branchCount?: number,      // default: 1
  startDate: string          // ISO date
}
```

**Статусы подписки:** `active`, `grace_period`, `blocked`, `cancelled`

---

## Бэк-офис — Счета (Admin Invoices)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| GET | `/api/admin/invoices` | Admin JWT | Все счета (фильтры: organizationId, status) |
| POST | `/api/admin/invoices` | superadmin, billing | Выставить счёт. Автогенерация номера INV-YYYYMM-XXX |
| PATCH | `/api/admin/invoices/[id]` | superadmin, billing | Обновить статус счёта. Оплата (paid) → разблокирует организацию и подписку |

**POST body:**
```
{
  subscriptionId: string,    // UUID
  periodStart: string,
  periodEnd: string,
  dueDate: string,
  amount?: number,           // автоматически из подписки если не указано
  comment?: string
}
```

**Статусы счёта:** `pending`, `paid`, `overdue`, `cancelled`

---

## Бэк-офис — Служебные (Admin Seed / Reset)

| Метод | Путь | Авторизация | Описание |
|-------|------|-------------|----------|
| POST | `/api/admin/seed` | Нет (только dev) | Создать суперадмина + тариф (одноразовый) |
| POST | `/api/admin/reset-db` | superadmin (только dev) | Полный сброс БД + seed. Только при `ALLOW_DESTRUCTIVE_API=true` |

> Оба эндпоинта заблокированы в production (кроме dev-сервера с `ALLOW_DESTRUCTIVE_API=true`).

---

## Статистика эндпоинтов

| Домен | Эндпоинтов |
|-------|-----------|
| Auth | 1 |
| Organization | 2 |
| Branches | 4 |
| Rooms | 4 |
| Employees | 4 |
| Directions | 4 |
| Clients | 5 |
| Wards | 1 |
| Portal Link | 2 |
| Groups | 5 |
| Enrollments | 2 |
| Generate Lessons | 1 |
| Schedule Templates | 1 |
| Lessons | 2 |
| Attendance | 2 |
| Subscriptions | 5 |
| Payments | 2 |
| Accounts | 4 |
| Account Operations | 2 |
| Expenses | 5 |
| Expense Categories | 1 |
| Salary Adjustments | 2 |
| Salary Payments | 2 |
| Periods | 2 |
| Audit | 1 |
| Tasks | 5 |
| Call Campaigns | 6 |
| Billing Status | 1 |
| Billing (ЛК) | 2 |
| Portal | 5 |
| Admin Auth | 3 |
| Admin Partners | 4 |
| Admin Plans | 4 |
| Admin Subscriptions | 3 |
| Admin Invoices | 3 |
| Admin Seed/Reset | 2 |
| **Итого** | **~103** |
