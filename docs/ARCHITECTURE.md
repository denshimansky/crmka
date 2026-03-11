# Архитектура Smart CRM v2.0

> **Версия:** 0.1 (черновик)
> **Дата:** 2026-03-11
> **Автор:** Денис Шиманский + Claude (Switch2bot)
> **Статус:** На ревью. Ожидает подтверждения перед началом разработки

---

## Содержание

1. [Стек технологий](#1-стек-технологий)
2. [Мультитенантность](#2-мультитенантность)
3. [Структура проекта](#3-структура-проекта)
4. [Схема базы данных](#4-схема-базы-данных)
5. [Аутентификация и роли](#5-аутентификация-и-роли)
6. [API-архитектура](#6-api-архитектура)
7. [Инфраструктура и деплой](#7-инфраструктура-и-деплой)
8. [План реализации MVP](#8-план-реализации-mvp)

---

## 1. Стек технологий

| Слой | Технология | Почему |
|------|-----------|--------|
| **Frontend** | Next.js 15 (App Router) | SSR, Server Actions, проверенный стек (как Life OS) |
| **Язык** | TypeScript | Типобезопасность, DX |
| **UI** | Tailwind CSS v4 + shadcn/ui | Быстрая вёрстка, готовые компоненты (таблицы, формы, модалки) |
| **БД** | PostgreSQL 16 | Надёжность, RLS для мультитенанта, JSONB для гибких полей |
| **ORM** | Drizzle ORM | Легковесный, типобезопасный, близко к SQL, быстрые миграции |
| **Аутентификация** | NextAuth.js v5 | JWT, magic link (email), Google OAuth |
| **Валидация** | Zod | Shared-схемы для фронта и бэка |
| **Деплой** | Docker Compose на VPS | Проверенный паттерн, полный контроль |
| **CI/CD** | GitHub Actions → webhook → auto-deploy | Как в Life OS |

### Осознанные отказы

| Не берём | Почему |
|----------|--------|
| Supabase/Firebase | Нужен полный контроль над БД, миграциями, RLS |
| tRPC | Избыточен — Server Actions + API Routes хватает |
| Redis | На 20 тенантов не нужен кэш-слой. Добавим когда понадобится |
| Отдельный API-сервер | Монолит быстрее для MVP, разделим если упрёмся |
| React Native | PWA достаточно для администраторов |

---

## 2. Мультитенантность

### Стратегия: shared database, shared schema, row-level isolation

Все тенанты в одной БД, в одних таблицах. Изоляция через `organization_id`.

```
┌─────────────────────────────────────────────┐
│                  PostgreSQL                   │
│                                               │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ Org A   │ │ Org B   │ │ Org C   │  ...   │
│  │ (rows)  │ │ (rows)  │ │ (rows)  │        │
│  └─────────┘ └─────────┘ └─────────┘        │
│                                               │
│  RLS Policy: WHERE organization_id = current  │
└─────────────────────────────────────────────┘
```

**Почему shared, а не schema-per-tenant:**
- 20 тенантов сейчас, 50-100 в перспективе — shared справится
- Проще миграции (ALTER TABLE один раз, не 50)
- Проще бэкапы и мониторинг
- RLS в PostgreSQL — зрелый механизм

### Изоляция данных

Каждая таблица (кроме системных) содержит `organization_id`:

```sql
-- Пример RLS-политики
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON clients
  USING (organization_id = current_setting('app.organization_id')::uuid);
```

Middleware устанавливает `app.organization_id` в начале каждого запроса.

### Системные таблицы (без tenant_id)

- `organizations` — список тенантов
- `users` — пользователи (могут быть в нескольких организациях)
- `user_organizations` — связь пользователь <> организация + роль
- `system_settings` — глобальные настройки платформы

---

## 3. Структура проекта

```
crmka/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Публичные страницы
│   │   ├── login/
│   │   └── invite/[token]/
│   ├── (app)/                    # Защищённые страницы (layout с сайдбаром)
│   │   ├── layout.tsx            # Сайдбар, хедер, тенант-контекст
│   │   ├── page.tsx              # Дашборд
│   │   ├── crm/                  # CRM-модуль
│   │   │   ├── leads/            # Воронка лидов
│   │   │   ├── clients/          # Клиентская база
│   │   │   ├── campaigns/        # Обзвоны
│   │   │   └── reports/          # CRM-отчёты
│   │   ├── schedule/             # Расписание
│   │   │   ├── groups/           # Группы
│   │   │   ├── calendar/         # Календарь занятий
│   │   │   └── attendance/       # Посещения
│   │   ├── finance/              # Финансы
│   │   │   ├── payments/         # Оплаты
│   │   │   ├── expenses/         # Расходы
│   │   │   ├── salary/           # Зарплата
│   │   │   └── reports/          # Финансовые отчёты
│   │   ├── subscriptions/        # Абонементы
│   │   ├── tasks/                # Задачи
│   │   └── settings/             # Настройки
│   │       ├── organization/     # Филиалы, кабинеты, направления
│   │       ├── users/            # Пользователи и роли
│   │       ├── directories/      # Справочники
│   │       └── billing/          # Подписка (SaaS-уровень)
│   └── api/                      # API Routes
│       ├── auth/[...nextauth]/
│       └── webhooks/
├── components/                   # UI-компоненты
│   ├── ui/                       # shadcn/ui (кнопки, инпуты, таблицы)
│   ├── layout/                   # Навигация, сайдбар, хедер
│   └── modules/                  # Бизнес-компоненты по модулям
│       ├── crm/
│       ├── schedule/
│       ├── finance/
│       └── ...
├── lib/                          # Серверная логика
│   ├── db/
│   │   ├── schema.ts             # Drizzle-схема
│   │   ├── migrations/           # SQL-миграции
│   │   └── index.ts              # Подключение к БД
│   ├── auth/                     # NextAuth конфиг
│   ├── tenant/                   # Мультитенант (middleware, context)
│   └── modules/                  # Бизнес-логика по модулям
│       ├── crm/
│       ├── schedule/
│       ├── finance/
│       └── ...
├── types/                        # Общие TypeScript-типы
├── hooks/                        # React-хуки
├── public/                       # Статика
├── docker-compose.yml
├── Dockerfile
├── drizzle.config.ts
└── package.json
```

### Навигация (сайдбар)

```
┌─────────────────────────┐
│  Smart CRM              │
│  [Название организации] │
├─────────────────────────┤
│                         │
│  🏠 Дашборд             │
│  📋 Задачи              │
│                         │
│  ▾ CRM                  │
│    📞 Лиды              │
│    👥 Клиенты           │
│    📢 Обзвоны           │
│    📊 Отчёты CRM        │
│                         │
│  ▾ Расписание           │
│    📅 Календарь         │
│    👨‍🏫 Группы           │
│    ✅ Посещения          │
│                         │
│  ▾ Финансы              │
│    💵 Оплаты            │
│    📦 Расходы           │
│    💼 Зарплата          │
│    📊 Отчёты            │
│                         │
│  📑 Абонементы          │
│                         │
│  ─────────────────────  │
│  ⚙️ Настройки           │
└─────────────────────────┘
```

---

## 4. Схема базы данных

### 4.0. Системные таблицы

```sql
-- Организации (тенанты)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                    -- "Детский центр Солнышко"
  slug TEXT UNIQUE NOT NULL,             -- "solnyshko" (для URL)
  plan TEXT NOT NULL DEFAULT 'basic',    -- SaaS-план
  is_active BOOLEAN NOT NULL DEFAULT true,
  settings JSONB DEFAULT '{}',           -- настройки организации
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Пользователи (глобальные)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  phone TEXT,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Связь пользователь <> организация
CREATE TABLE user_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  role TEXT NOT NULL DEFAULT 'admin',     -- 'owner' | 'manager' | 'admin' | 'instructor'
  is_active BOOLEAN NOT NULL DEFAULT true,
  permissions JSONB DEFAULT '{}',         -- гранулярные права
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, organization_id)
);
```

### 4.1. Справочники (настройки организации)

```sql
-- Филиалы
CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,                     -- "Филиал на Ленина"
  address TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Кабинеты
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,                     -- "Кабинет 1", "Зал"
  capacity INT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT DEFAULT 0
);

-- Направления (виды услуг)
CREATE TABLE directions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,                     -- "Английский", "Скорочтение"
  base_price NUMERIC(10,2),              -- базовая стоимость занятия
  duration_minutes INT DEFAULT 60,       -- длительность по умолчанию
  color TEXT,                            -- цвет для расписания
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT DEFAULT 0
);

-- Каналы привлечения
CREATE TABLE lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,                     -- "Instagram", "Сарафан", "Авито"
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT DEFAULT 0
);

-- Виды дней (посещений)
CREATE TABLE attendance_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,                     -- "Явка", "Прогул", "Перерасчёт"
  short_name TEXT NOT NULL,              -- "Я", "П", "ПР"
  deducts_balance BOOLEAN DEFAULT true,  -- списывать с абонемента?
  deduction_percent INT DEFAULT 100,     -- % списания (100 = полное)
  accrues_salary BOOLEAN DEFAULT true,   -- начислять ЗП?
  color TEXT,                            -- цвет в журнале
  is_system BOOLEAN DEFAULT false,       -- системный (не удалить)
  sort_order INT DEFAULT 0
);

-- Статьи расходов
CREATE TABLE expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,                     -- "Аренда", "Канцтовары"
  is_fixed BOOLEAN DEFAULT true,         -- постоянные / переменные
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT DEFAULT 0
);

-- Кассы / банковские счета
CREATE TABLE cash_registers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  branch_id UUID REFERENCES branches(id), -- NULL = общий
  name TEXT NOT NULL,                     -- "Касса наличные", "Расчётный счёт"
  type TEXT NOT NULL DEFAULT 'cash',      -- 'cash' | 'bank' | 'online'
  balance NUMERIC(12,2) DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Причины отчисления
CREATE TABLE dropout_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,                     -- "Переезд", "Финансы", "Не нравится"
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Типы скидок
CREATE TABLE discount_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,                     -- "Многодетные", "Сотрудники", "2-е направление"
  percent NUMERIC(5,2),                  -- % скидки
  is_stackable BOOLEAN DEFAULT false,    -- суммируется с другими?
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Производственный календарь
CREATE TABLE work_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  year INT NOT NULL,
  month INT NOT NULL,
  day INT NOT NULL,
  is_working BOOLEAN NOT NULL DEFAULT true,
  note TEXT,                              -- "8 марта", "Каникулы"
  UNIQUE (organization_id, year, month, day)
);
```

### 4.2. CRM

```sql
-- Контакты (лиды + клиенты — единая таблица)
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),

  -- Основные данные
  name TEXT,                              -- ФИО (опц.)
  phone TEXT,                             -- телефон (опц.)
  phone2 TEXT,                            -- доп. телефон
  email TEXT,
  social_link TEXT,                       -- VK/Telegram/другое

  -- CRM
  status TEXT NOT NULL DEFAULT 'new',     -- см. enum ниже
  source_id UUID REFERENCES lead_sources(id),
  assigned_to UUID REFERENCES users(id), -- ответственный менеджер
  next_contact_date DATE,                -- дата следующего контакта

  -- Клиентский баланс (после первой оплаты)
  balance NUMERIC(12,2) DEFAULT 0,       -- денежный баланс клиента

  -- Метки
  is_blacklisted BOOLEAN DEFAULT false,
  blacklist_reason TEXT,
  blacklisted_by UUID REFERENCES users(id),
  blacklisted_at TIMESTAMPTZ,

  notes TEXT,                             -- произвольные заметки
  custom_fields JSONB DEFAULT '{}',       -- доп. поля

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Статусы контактов (enum):
-- Лиды:    'new' -> 'trial_scheduled' -> 'trial_visited' -> 'awaiting_payment' -> 'active'
-- Клиенты: 'active' -> 'inactive' (нет абонемента > 30 дней)
-- Прочее:  'potential', 'not_target', 'blacklisted', 'archived'

-- Подопечные (дети)
CREATE TABLE dependents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  name TEXT NOT NULL,
  birth_date DATE,
  notes TEXT,
  custom_fields JSONB DEFAULT '{}'
);

-- История коммуникации
CREATE TABLE communication_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  user_id UUID NOT NULL REFERENCES users(id),  -- кто записал
  type TEXT NOT NULL DEFAULT 'note',     -- 'call' | 'visit' | 'note' | 'sms' | 'auto'
  content TEXT NOT NULL,
  next_contact_date DATE,                -- обновляет contacts.next_contact_date
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Обзвоны (кампании)
CREATE TABLE call_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,                     -- "Возврат ушедших март 2026"
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'completed' | 'archived'
  filters JSONB,                          -- критерии фильтрации
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE call_campaign_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES call_campaigns(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'called' | 'skipped'
  result TEXT,                            -- результат звонка
  called_by UUID REFERENCES users(id),
  called_at TIMESTAMPTZ
);
```

### 4.3. Расписание и группы

```sql
-- Группы
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  room_id UUID NOT NULL REFERENCES rooms(id),
  direction_id UUID NOT NULL REFERENCES directions(id),
  instructor_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,                     -- "Английский Пн-Ср 10:00"
  max_students INT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Шаблон расписания группы (дни недели + время)
CREATE TABLE group_schedule_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id),
  day_of_week INT NOT NULL,              -- 1=Пн ... 7=Вс
  start_time TIME NOT NULL,              -- 10:00
  duration_minutes INT NOT NULL DEFAULT 60,
  UNIQUE (group_id, day_of_week)
);

-- Занятия (конкретные уроки, сгенерированные из шаблона)
CREATE TABLE lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  group_id UUID NOT NULL REFERENCES groups(id),
  instructor_id UUID NOT NULL REFERENCES users(id),  -- может отличаться (замена)
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  duration_minutes INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- 'scheduled' | 'completed' | 'cancelled'
  cancel_reason TEXT,
  is_replacement BOOLEAN DEFAULT false,   -- замена инструктора
  is_extra BOOLEAN DEFAULT false,         -- доп. занятие / отработка
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Состав группы (какие подопечные в какой группе)
CREATE TABLE group_students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),       -- клиент
  dependent_id UUID REFERENCES dependents(id),             -- подопечный (опц.)
  subscription_id UUID REFERENCES subscriptions(id),       -- абонемент
  enrolled_at DATE NOT NULL DEFAULT CURRENT_DATE,
  dropped_at DATE,                        -- дата отчисления
  dropout_reason_id UUID REFERENCES dropout_reasons(id),
  dropout_note TEXT,
  -- При переводе:
  transferred_to_group_id UUID REFERENCES groups(id),
  transfer_counts_as_churn BOOLEAN,       -- считается оттоком для старого инструктора?
  UNIQUE (group_id, contact_id, dependent_id)
);
```

### 4.4. Посещения

```sql
-- Посещения (факт присутствия на занятии)
CREATE TABLE attendances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  lesson_id UUID NOT NULL REFERENCES lessons(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  dependent_id UUID REFERENCES dependents(id),
  attendance_type_id UUID NOT NULL REFERENCES attendance_types(id),

  -- Финансовые последствия (рассчитываются автоматически)
  amount_deducted NUMERIC(10,2) DEFAULT 0,    -- списано с абонемента
  salary_accrued NUMERIC(10,2) DEFAULT 0,     -- начислено инструктору

  subscription_id UUID REFERENCES subscriptions(id), -- с какого абонемента списали
  marked_by UUID NOT NULL REFERENCES users(id),
  marked_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (lesson_id, contact_id, dependent_id)
);

-- Закрытие периодов
CREATE TABLE period_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  year INT NOT NULL,
  month INT NOT NULL,
  locked_by UUID NOT NULL REFERENCES users(id),
  locked_at TIMESTAMPTZ DEFAULT now(),
  unlocked_by UUID REFERENCES users(id),
  unlocked_at TIMESTAMPTZ,
  is_locked BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (organization_id, year, month)
);
```

### 4.5. Абонементы

```sql
-- Абонементы
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  dependent_id UUID REFERENCES dependents(id),
  group_id UUID NOT NULL REFERENCES groups(id),
  direction_id UUID NOT NULL REFERENCES directions(id),

  type TEXT NOT NULL DEFAULT 'calendar',  -- 'calendar' | 'fixed' (v1.1) | 'package' (v2)

  -- Период
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,                 -- конец месяца для календарного

  -- Финансы
  price_per_lesson NUMERIC(10,2) NOT NULL, -- стоимость за занятие
  total_amount NUMERIC(12,2) NOT NULL,     -- итого к оплате
  balance NUMERIC(12,2) NOT NULL DEFAULT 0, -- текущий остаток

  -- Скидки
  discount_type_id UUID REFERENCES discount_types(id),
  discount_percent NUMERIC(5,2) DEFAULT 0,
  linked_subscription_id UUID REFERENCES subscriptions(id), -- связанная скидка

  status TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'expired' | 'cancelled'

  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.6. Финансы

```sql
-- Оплаты
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  subscription_id UUID REFERENCES subscriptions(id),     -- NULL = на баланс клиента

  amount NUMERIC(12,2) NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',    -- 'cash' | 'card' | 'transfer'
  cash_register_id UUID NOT NULL REFERENCES cash_registers(id),

  note TEXT,
  received_by UUID NOT NULL REFERENCES users(id),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Расходы
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),

  category_id UUID NOT NULL REFERENCES expense_categories(id),
  amount NUMERIC(12,2) NOT NULL,
  description TEXT,

  -- Привязка
  branch_id UUID REFERENCES branches(id),     -- NULL = все филиалы
  room_id UUID REFERENCES rooms(id),
  direction_id UUID REFERENCES directions(id),

  cash_register_id UUID NOT NULL REFERENCES cash_registers(id),

  -- Распределение на N месяцев (FIN-19)
  spread_months INT DEFAULT 1,            -- 1 = обычный расход
  spread_start_date DATE,                 -- начало распределения

  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Перемещения между кассами
CREATE TABLE cash_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  from_register_id UUID NOT NULL REFERENCES cash_registers(id),
  to_register_id UUID NOT NULL REFERENCES cash_registers(id),
  amount NUMERIC(12,2) NOT NULL,
  note TEXT,
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Возвраты
CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  amount NUMERIC(12,2) NOT NULL,
  cash_register_id UUID NOT NULL REFERENCES cash_registers(id),
  reason TEXT,
  refunded_by UUID NOT NULL REFERENCES users(id),
  refund_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Плановые расходы (бюджет)
CREATE TABLE expense_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  category_id UUID NOT NULL REFERENCES expense_categories(id),
  branch_id UUID REFERENCES branches(id),
  year INT NOT NULL,
  month INT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  UNIQUE (organization_id, category_id, branch_id, year, month)
);
```

### 4.7. Зарплата

```sql
-- Ставки инструкторов
CREATE TABLE salary_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),             -- инструктор

  branch_id UUID REFERENCES branches(id),                  -- NULL = все
  direction_id UUID REFERENCES directions(id),             -- NULL = все
  group_id UUID REFERENCES groups(id),                     -- NULL = по направлению

  type TEXT NOT NULL,                     -- 'per_student' | 'per_lesson' | 'per_lesson_plus_student'
  rate_per_student NUMERIC(10,2),         -- ставка за ученика
  rate_per_lesson NUMERIC(10,2),          -- ставка за занятие (фикс)

  effective_from DATE NOT NULL,
  effective_to DATE,                      -- NULL = бессрочно

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Начисления ЗП (автоматически при отметке посещений)
CREATE TABLE salary_accruals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),             -- инструктор
  lesson_id UUID NOT NULL REFERENCES lessons(id),

  students_count INT NOT NULL,
  rate_applied NUMERIC(10,2) NOT NULL,    -- применённая ставка
  amount NUMERIC(10,2) NOT NULL,          -- итого начислено за занятие

  salary_rate_id UUID REFERENCES salary_rates(id),
  is_manual_override BOOLEAN DEFAULT false, -- ручная корректировка ставки

  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);

-- Премии / штрафы
CREATE TABLE salary_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,                     -- 'bonus' | 'penalty'
  amount NUMERIC(10,2) NOT NULL,
  reason TEXT NOT NULL,
  effective_date DATE NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Выплаты ЗП
CREATE TABLE salary_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(12,2) NOT NULL,
  cash_register_id UUID NOT NULL REFERENCES cash_registers(id),
  period_from DATE,                       -- за какой период
  period_to DATE,
  note TEXT,
  paid_by UUID NOT NULL REFERENCES users(id),
  payout_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.8. Задачи

```sql
-- Задачи
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),

  title TEXT NOT NULL,
  description TEXT,

  -- Привязка
  contact_id UUID REFERENCES contacts(id),
  source_type TEXT,                       -- 'contact_date' | 'trial' | 'payment' | 'birthday' | 'absence' | 'manual'
  source_id UUID,                         -- ID источника (лид, занятие и т.д.)

  assigned_to UUID REFERENCES users(id),
  due_date DATE,

  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'done' | 'cancelled'
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id),

  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.9. Индексы (ключевые)

```sql
-- Тенант-изоляция (на каждой таблице)
CREATE INDEX idx_contacts_org ON contacts(organization_id);
CREATE INDEX idx_lessons_org ON lessons(organization_id);
CREATE INDEX idx_payments_org ON payments(organization_id);
CREATE INDEX idx_attendances_org ON attendances(organization_id);

-- Частые запросы
CREATE INDEX idx_contacts_status ON contacts(organization_id, status);
CREATE INDEX idx_contacts_phone ON contacts(organization_id, phone);
CREATE INDEX idx_contacts_next_contact ON contacts(organization_id, next_contact_date);
CREATE INDEX idx_lessons_date ON lessons(organization_id, date);
CREATE INDEX idx_lessons_group_date ON lessons(group_id, date);
CREATE INDEX idx_attendances_lesson ON attendances(lesson_id);
CREATE INDEX idx_payments_contact ON payments(organization_id, contact_id);
CREATE INDEX idx_payments_date ON payments(organization_id, payment_date);
CREATE INDEX idx_subscriptions_contact ON subscriptions(organization_id, contact_id);
CREATE INDEX idx_tasks_assigned ON tasks(organization_id, assigned_to, status, due_date);
CREATE INDEX idx_salary_accruals_user ON salary_accruals(organization_id, user_id);
CREATE INDEX idx_group_students_group ON group_students(group_id);
```

---

## 5. Аутентификация и роли

### Вход в систему

1. **Magic link (email)** — основной способ. Администраторы часто меняют устройства
2. **Google OAuth** — опционально
3. **Инвайт-система**: owner создаёт приглашение -> email со ссылкой -> пользователь попадает в организацию

### Роли

| Роль | Описание | Примеры прав |
|------|----------|-------------|
| **owner** | Владелец/руководитель | Всё. Финрез, закрытие периодов, удаление данных, управление пользователями |
| **manager** | Управляющий | Почти всё, кроме SaaS-настроек. CRM, финансы, зарплата, отчёты |
| **admin** | Администратор | CRM-воронка, посещения, оплаты приём, задачи. Без зарплат и финреза |
| **instructor** | Инструктор/педагог | Только свои группы: отметка посещений, расписание. Read-only |

### Гранулярные права (JSONB)

Для нестандартных случаев — `permissions` в `user_organizations`:

```json
{
  "branches": ["uuid1", "uuid2"],
  "can_see_salary": false,
  "can_close_period": true,
  "can_edit_past": false
}
```

---

## 6. API-архитектура

### Server Actions (основной паттерн)

```typescript
// lib/modules/crm/actions.ts
'use server'

export async function createContact(data: CreateContactInput) {
  const { organizationId } = await requireAuth()
  const validated = createContactSchema.parse(data)

  // Проверка дублей по телефону
  const existing = await db.query.contacts.findFirst({
    where: and(
      eq(contacts.organizationId, organizationId),
      eq(contacts.phone, validated.phone)
    )
  })
  if (existing) return { error: 'duplicate', existing }

  const contact = await db.insert(contacts).values({
    ...validated,
    organizationId,
  }).returning()

  revalidatePath('/crm/leads')
  return { data: contact }
}
```

### API Routes (для внешних интеграций)

- `POST /api/webhooks/payment` — уведомления от эквайринга (v2)
- `GET /api/export/[report]` — выгрузка отчётов

### Паттерны

- **Все мутации** — через Server Actions (формы, кнопки)
- **Все запросы** — через серверные компоненты (прямой доступ к БД)
- **Реалтайм** — не нужен на MVP (polling с revalidate)
- **Валидация** — Zod-схемы, shared между клиентом и сервером

---

## 7. Инфраструктура и деплой

### Вариант: отдельный VPS

```
VPS (new)
├── Docker Compose
│   ├── app (Next.js, standalone)    :3000
│   └── db  (PostgreSQL 16)          :5432
├── nginx (системный)                :80, :443
│   └── umnayacrm.ru -> :3000
├── certbot (Let's Encrypt)
└── webhook (auto-deploy on push)
```

**Почему отдельный VPS:**
- Коммерческий продукт != личные данные (Life OS)
- Независимый деплой, независимые бэкапы
- Проще масштабировать
- Стоимость: ~500-1000 руб./мес (Timeweb/Selectel)

### Бэкапы

- PostgreSQL: `pg_dump` ежедневно -> S3/Яндекс Диск
- Ретенция: 7 daily + 4 weekly
- Тест восстановления: раз в месяц

### Мониторинг

- Uptime: простой healthcheck + уведомление в Telegram
- Ошибки: Sentry (бесплатный тир)

---

## 8. План реализации MVP

### Спринт 0: Фундамент (неделя 1)
- [ ] Инициализация проекта (Next.js, Drizzle, shadcn/ui)
- [ ] Схема БД + миграции
- [ ] Аутентификация (NextAuth, magic link)
- [ ] Мультитенант middleware + RLS
- [ ] Layout (сайдбар, хедер, роутинг)
- [ ] Seed: тестовая организация с данными

### Спринт 1: Справочники + CRM (недели 2-3)
- [ ] Настройки: филиалы, кабинеты, направления, справочники
- [ ] Контакты: CRUD, карточка, поиск, дубли
- [ ] Воронка лидов: канбан/таблица, статусы, фильтры
- [ ] История коммуникации
- [ ] Обзвон: кампании, списки
- [ ] CRM-отчёты: воронка, конверсия, доходимость, каналы

### Спринт 2: Расписание + Посещения (недели 4-5)
- [ ] Группы: CRUD, шаблоны, состав
- [ ] Генерация занятий из шаблона
- [ ] Просмотр расписания (календарь): по кабинетам, инструкторам, группам
- [ ] Посещения: журнал, отметка, виды дней
- [ ] Замена инструктора
- [ ] Отмена / доп. занятия

### Спринт 3: Абонементы + Оплаты (недели 6-7)
- [ ] Абонементы: создание, баланс, скидки, отчисление
- [ ] Оплаты: приём, привязка к абонементу, баланс клиента
- [ ] Должники: отчёт, обещанная дата
- [ ] Расходы: CRUD, статьи, распределение
- [ ] Кассы: остатки, перемещения
- [ ] Возвраты

### Спринт 4: Зарплата + Финансы (недели 8-9)
- [ ] Ставки инструкторов
- [ ] Автоначисление при отметке посещений
- [ ] Выплаты, премии, штрафы
- [ ] Карточка сотрудника
- [ ] ДДС, финрез (P&L), прогноз прибыли
- [ ] Закрытие периодов

### Спринт 5: Дашборд + Задачи + Polish (недели 10-11)
- [ ] Дашборд: виджеты по роли
- [ ] Задачи: ручные + автоматические
- [ ] Уведомления
- [ ] PWA: манифест, иконки, offline
- [ ] Тестирование, баг-фикс
- [ ] Миграция данных из 1С (скрипт)

### Спринт 6: Деплой + Миграция (неделя 12)
- [ ] Деплой на VPS
- [ ] Тестирование с реальными данными
- [ ] Обучение клиентов
- [ ] Запуск

---

## Открытые вопросы

| # | Вопрос | Влияние | Статус |
|---|--------|---------|--------|
| 1 | Домен: **umnayacrm.ru** | Деплой, SSL | ✅ Решено |
| 2 | **Отдельный VPS** (Timeweb) | Инфра | ✅ Решено |
| 3 | Миграция из 1С: **автоматическая** (доступ к базам будет) | Спринт 5 | ✅ Решено |
| 4 | **PWA** на старте | UX | ✅ Решено |
| 5 | SMTP от **Timeweb** (для magic link) | Auth | ✅ Решено |
| 6 | **Белый лейбл** — да, предусмотреть (лого, название, цвета партнёра). Франшизы в перспективе | UI | ✅ Решено |
