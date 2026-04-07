# Deep Validation Audit — CRMka
**Дата:** 2026-04-07
**Версия проекта:** v1.4.1-alpha (commit b3c76db)
**Автор:** Nox (AI audit)

---

## Executive Summary

| Направление | Оценка | Критичных | Высоких | Средних | Низких |
|---|---|---|---|---|---|
| API бизнес-логика | 78/100 | 4 | 4 | 9 | 4 |
| Схема vs Data Dictionary | 60% complete | 17 | 24 | 19 | 8 |
| Покрытие мега-теста | 51% features | 5 | 7 | 6 | 4 |
| Отчёты vs reports-logic.md | 7/10 correct | 1 | 2 | 0 | 0 |
| Безопасность | 6/10 | 1 | 5 | 5 | 4 |

**Общая готовность к MVP: ~65%**
Фундамент крепкий, но есть серьёзные пробелы в финансовой логике, безопасности и тестовом покрытии.

---

## 1. API БИЗНЕС-ЛОГИКА (78/100)

### CRITICAL

**1.1. Нет enforcement закрытия периода (PRD US-015)**
Все мутации (payments, attendance, expenses, salary) работают без проверки закрытого периода.
Админ может ретроактивно менять данные закрытого месяца.
→ Fix: добавить `periodClosed` check с role-based enforcement (owner/manager bypass)

**1.2. Неполная конверсия Лид→Клиент**
PRD: конверсия при первой оплате ИЛИ первом платном занятии.
Код: только при первой оплате (`/api/payments`).
Attendance не проверяет/конвертирует статус лида.
→ Fix: в attendance POST после charge проверять и конвертировать

**1.3. N+1 в bulk attendance**
PUT handler: loop с findUnique + update per enrollment.
30 студентов = 90+ DB round-trips.
→ Fix: `db.$transaction()` + batch findMany

**1.4. Нет транзакций в каскадных операциях**
POST attendance: создание записи + обновление баланса подписки — НЕ обёрнуто в `$transaction()`.
При сбое второго запроса — attendance создан, баланс не обновлён.
→ Fix: обернуть в `db.$transaction()`

### HIGH

**1.5. Нет RBAC на payments и salary-payments**
Любой авторизованный может создавать платежи и зарплатные выплаты.
→ Fix: проверка role (owner/manager/admin)

**1.6. Race condition в "первая оплата"**
`payment.count() === 0` без транзакции — два одновременных платежа оба могут стать "первой оплатой".
→ Fix: перенести в transaction

**1.7. Attendance без проверки статуса подписки**
Charge применяется к subscription без проверки статуса (closed/withdrawn тоже заряжаются).
→ Fix: `status: { in: ["active", "pending"] }`

**1.8. Account balance может уйти в минус**
AccountOperation не проверяет достаточность баланса перед списанием.

### MEDIUM (выборочно)
- Пагинация: `take: 200/500` без cursor — на больших объёмах потеря данных
- Soft delete edge case: PATCH подписки после удаления оплаты пересчитывает баланс неверно
- Email партнёра не валидируется через `.email()`
- Inconsistent error messages (ru/en mix)

---

## 2. СХЕМА PRISMA vs DATA DICTIONARY

**Схема реализует ~60% от DD v1.2**

### Отсутствующие таблицы (23 штуки)
Ключевые для MVP:
- **TrialLesson** — пробные занятия (ломает Attendance)
- **ClientBalanceTransaction** — операции с балансом клиента
- **IntegrationSettings** — настройки платёжных систем (ЮKassa, Робокасса)
- **Period** — закрытие месяца (soft close)
- **SalaryAccrual** — детализация начислений ЗП
- **ClientPortalUser** — отдельная авторизация портала клиента
- **Notification** — уведомления in-app

Для v1.1+:
- ProductionCalendar, InstructorSubstitution, TaskTemplate
- StockItem/Balance/Movement, CommunicationLog
- WithdrawalReason, AbsenceReason, MarketingChannel

### Критичные несоответствия полей
- **Organization**: нет 16 полей (status, tariff_plan_id, onboarding_*, yukassa/robokassa keys, negative_balance_*)
- **Employee**: нет type (ACTIVE/CANDIDATE), hire_date, fire_date, can_view_own_salary
- **SalaryRate**: неправильный enum (SalaryScheme vs SalaryRateType), нет branch_id/group_id/effective_from/to, нет fixed_salary/per_shift
- **Direction**: wrong field names (lessonPrice vs base_lesson_price), trial default wrong (false vs true)
- **GroupEnrollment**: нет subscription_id (связь с биллингом)
- **EmployeeBranch**: нет tenant_id (критичный баг мультитенантности!)

### Отсутствующие enum-ы (18)
OrgStatus, EmployeeType, CandidateStatus, SalaryRateType (с fixed_salary/per_shift), NegativeBalanceAction, OnboardingStatus, TrialStatus, PeriodStatus и др.

### Индексы
8 рекомендованных составных индексов из DD не реализованы (Subscription tenant+client+status, Payment tenant+client+subscription и др.)

### deleted_at
Отсутствует на: Ward, Lesson, Discount, Attendance, SalaryPayment, SalaryAdjustment

---

## 3. ПОКРЫТИЕ МЕГА-ТЕСТА

**Количественно: 47/92 features (51%)**

### Что покрыто хорошо
- Создание организации через бэк-офис ✓
- CRUD клиентов/лидов/подопечных ✓
- Расписание: группы → шаблоны → генерация → зачисление ✓
- Подписки + оплаты (happy path) ✓
- Расходы (4 категории) ✓
- 8 отчётов загружаются ✓

### Критичные пробелы

**Ноль DB assertions.** Все проверки — UI visibility. Ни одна сумма не верифицирована.
- После оплаты: balance клиента НЕ проверяется
- После расхода: баланс счёта НЕ проверяется
- P&L: значения НЕ проверяются (только текст "Прибыль" виден)

**Мультитенантность НЕ тестируется.** Ноль проверок изоляции данных между организациями.

**RBAC: только owner.** Manager, admin, instructor, readonly — НЕ тестируются.

**Финансовые edge cases:**
- Нулевой баланс подписки ❌
- Переплата ❌
- Отрицательный баланс ❌
- Подписка с истекшим сроком ❌
- Перенос остатка при закрытии подписки ❌

**Бизнес-логика:**
- Lead→Client конверсия: платёж создаётся, но смена статуса НЕ верифицируется ❌
- 3 типа зарплатных схем — тестируется только одна ❌
- Амортизация расходов ❌
- Пробные занятия ❌
- Отработки ❌

### Метрики
```
Файлов тестов:        19 (179 describe-блоков)
Мега-тест:            1260 + 627 строк
Assertions (expect):  ~3 штуки (!)
DB верификация:       0%
Финансовые проверки:  0%
Мультитенант тесты:   0
RBAC тесты:           0
```

---

## 4. ОТЧЁТЫ vs REPORTS-LOGIC.MD

### Реализовано: 10/10 MVP-отчётов

| Отчёт | Статус |
|---|---|
| Средний чек | ✓ Корректно |
| Непродлённые абонементы | ✓ Корректно |
| Детализация оттока | ✓ Корректно |
| Посещения | ✓ Корректно |
| Выручка | ✓ Корректно |
| Сводный по педагогам | ✓ Корректно |
| **P&L (Финрез)** | 🔴 **БАГ: фильтр переменных расходов по неправильному полю** |
| **Воронка продаж** | ⚠ **Показывает lifetime вместо месяца; нет пробников/ожидающих оплату** |
| **Свободные места** | ⚠ **Нет 2 из 4 столбцов (пробники, ждём оплату)** |
| Должники | Не проверен |

### CRITICAL: P&L — баг в расчёте маржи
**Файл:** `reports/finance/pnl/page.tsx:63`
```
expenses.filter(e => e.isVariable)  // ← НЕПРАВИЛЬНО
expenses.filter(e => e.category.isVariable)  // ← ПРАВИЛЬНО
```
Переменные расходы фильтруются по полю расхода, а не категории → маржа и прибыль считаются неверно.

### Не реализовано: ~40 отчётов из reports-logic.md
Это ожидаемо для MVP, но после запуска потребуется 40+ отчётов для полного соответствия 1С-функционалу.

---

## 5. БЕЗОПАСНОСТЬ (6/10)

### CRITICAL
**5.1. Нет Row Level Security в PostgreSQL**
Мультитенантность только на уровне приложения. При компрометации БД — доступ ко всем организациям.

### HIGH (5 штук)
**5.2. /api/admin/seed и /api/admin/reset-db доступны в production**
Seed: если нет суперадмина — любой может создать. Reset-db: полный сброс БД через API.
→ Fix: проверка `NODE_ENV !== "production"`

**5.3. Нет CSRF защиты** (0 результатов grep по csrf)

**5.4. Нет Rate Limiting** (brute-force логинов, DoS)

**5.5. Пароли: минимум 6 символов** для финансового приложения

**5.6. Portal token живёт 7 дней** (слишком долго для токена из URL)

### MEDIUM
- AuditLog таблица есть в схеме, но НЕ ИСПОЛЬЗУЕТСЯ
- Нет max-length валидации на input-полях
- RBAC непоследовательный (payments и salary-payments без проверки ролей)
- Нет CSP headers

### Хорошее
- ✓ Bcrypt с salt(10)
- ✓ JWT HttpOnly cookies
- ✓ Prisma (нет raw SQL → нет SQL injection)
- ✓ HTTPS через Let's Encrypt + nginx
- ✓ Admin auth отделена от основной
- ✓ Одинаковое сообщение при неверном email/пароле

---

## ПРИОРИТЕЗИРОВАННЫЙ ПЛАН ДЕЙСТВИЙ

### Фаза 0: БЛОКЕРЫ (до пилота, апрель 2026)
1. **P&L баг** — fix фильтра переменных расходов (5 мин)
2. **Seed/Reset-db** — добавить NODE_ENV check (10 мин)
3. **$transaction()** в attendance POST и payment POST (2 часа)
4. **RBAC на payments/salary-payments** (1 час)
5. **Проверка статуса подписки** в attendance (30 мин)

### Фаза 1: ДО MVP (июнь 2026)
6. Period closure enforcement (4 часа)
7. Lead→Client конверсия при attendance (2 часа)
8. Rate limiting middleware (2 часа)
9. N+1 fix в bulk attendance (4 часа)
10. DB assertions в мега-тесте (8 часов)
11. Мультитенантность test (4 часа)
12. RBAC test для 5 ролей (4 часа)
13. Воронка и Capacity отчёты — дополнить (4 часа)
14. Усилить пароли (12+ символов) (30 мин)

### Фаза 2: ПОСЛЕ MVP (v1.1)
15. PostgreSQL RLS policies
16. CSRF middleware
17. AuditLog для финансовых операций
18. Схема: добавить недостающие таблицы/поля из DD
19. Оставшиеся 40 отчётов
20. CSP headers

---

## ИТОГО

Проект в хорошем состоянии для альфы. Архитектура правильная, основные модули работают, мега-тест покрывает happy path. Но есть конкретные баги (P&L, отсутствие транзакций) и пробелы (RBAC, мультитенант-тесты), которые нужно закрыть до MVP.

**Самый быстрый ROI**: фазу 0 (5 пунктов) можно закрыть за 1 день и сразу повысить надёжность на порядок.
