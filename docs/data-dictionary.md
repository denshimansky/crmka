# Data Dictionary — Умная CRM v2.0

> **Версия:** 1.2
> **Дата:** 20.03.2026 (обновлено по итогам аудит-встречи 19.03.2026)
> **Источники:** [PRD.md](PRD.md) (v2.0), [reports-logic.md](reports-logic.md), [backoffice.md](backoffice.md)
> **Назначение:** Полный перечень сущностей, полей, типов данных, ограничений и связей. Используется для генерации Prisma-схемы и проектирования API.
>
> **Changelog v1.2 (19.03.2026 аудит-встреча):**
> - Attendance: subscription_id стал nullable, добавлен trial_lesson_id
> - Новая таблица AccountOperation (внутренние кассовые операции)
> - SubscriptionStatus: добавлен статус pending
> - GroupEnrollment: добавлено поле selected_days
> - Добавлен deleted_at ко всем ключевым сущностям
> - TrialLesson: добавлен payment_id
> - Новая таблица ClientBalanceTransaction
> - Expense: добавлены поля is_recurring, recurring_group_id
> - Новая таблица ClientDocument
> - Новая таблица IntegrationSettings (миграция из Organization)
> - Новая таблица AdminBonusSettings (замена AdminBonus)
> - Описаны структуры JSON-полей
> - Employee: добавлен login, описана модель авторизации
> - Client: добавлена заметка о переходе статусов
> - Расширены рекомендации по индексам

## Соглашения

- **PK** — Primary Key (всегда `id UUID`)
- **FK** — Foreign Key (указана целевая таблица)
- **Soft delete** — поле `deleted_at` вместо физического удаления
- **Мультитенант** — `tenant_id` на каждой таблице (кроме `Organization`, `BackofficeUser`, `TariffPlan`, `Invoice`)
- Все даты хранятся в UTC
- Денежные суммы — `Decimal(12,2)` (копейки не используем, точность 2 знака)
- Перечисления (enum) выделены отдельно в конце документа

---

## Organization

Партнёр — организация, покупающая подписку SaaS. Корневая сущность мультитенанта.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| name | String | да | Название организации | — |
| legal_name | String | нет | Юридическое наименование | — |
| inn | String | нет | ИНН | — |
| contact_person | String | нет | Контактное лицо | — |
| phone | String | нет | Телефон контактного лица | — |
| email | String | нет | Email | — |
| status | OrgStatus | да | Активный / Приостановлен / Заблокирован / Архив | — |
| tariff_plan_id | UUID | нет | FK → TariffPlan | Текущий тариф |
| subscription_start | DateTime | нет | Дата начала подписки | — |
| next_payment_date | Date | нет | Дата следующей оплаты | — |
| grace_until | DateTime | нет | Конец грейс-периода (null = не в грейсе) | — |
| pay_instructor_for_absence | Boolean | да | Платить инструктору за прогул ученика (дефолт false) | Настройка организации |
| attendance_deadline_days | Int | да | Дедлайн отметки посещений (дефолт 14) | Настройка организации |
| makeup_lesson_limit | Int | нет | Лимит отработок (null = без лимита) | Настройка организации |
| makeup_lesson_deadline_days | Int | нет | Срок отработки в днях | Настройка организации |
| negative_balance_limit | Decimal(12,2) | нет | Лимит отрицательного баланса клиента (null = без лимита) | Настройка организации |
| negative_balance_action | NegativeBalanceAction | нет | Действие при превышении лимита | — |
| yukassa_shop_id | String | нет | API: ЮKassa shop ID | — |
| yukassa_secret_key | String | нет | API: ЮKassa секретный ключ (зашифрован) | — |
| robokassa_login | String | нет | API: Робокасса логин | — |
| robokassa_password1 | String | нет | API: Робокасса пароль 1 (зашифрован) | — |
| robokassa_password2 | String | нет | API: Робокасса пароль 2 (зашифрован) | — |
| logo_url | String | нет | Логотип организации (для экспорта) | — |
| role_display_names | Json | нет | Кастомные отображаемые названия ролей, например: {"instructor": "тренер", "admin": "администратор"}. null = стандартные названия | Настройка организации |
| onboarding_status | OnboardingStatus | да | Статус прохождения wizard | — |
| onboarding_needs_help | Boolean | да | Флаг «нужна помощь» (дефолт false) | — |
| onboarding_assigned_to | UUID | нет | FK → BackofficeUser | Ответственный из команды CRMka |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

---

## Branch

Филиал — физическая локация бизнеса.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| name | String | да | Название филиала | — |
| address | String | нет | Адрес | — |
| phone | String | нет | Телефон филиала | — |
| working_hours_start | Time | нет | Начало рабочего дня (для расчёта загрузки) | — |
| working_hours_end | Time | нет | Конец рабочего дня | — |
| working_days | Int[] | нет | Рабочие дни недели (0-6, пн=0) | — |
| is_active | Boolean | да | Активен (дефолт true) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| deleted_at | DateTime | нет | Мягкое удаление | — |

---

## Room

Кабинет — помещение внутри филиала.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| branch_id | UUID | да | FK → Branch | Филиал |
| name | String | да | Название кабинета | — |
| capacity | Int | нет | Вместимость (чел.) | — |
| is_active | Boolean | да | Активен (дефолт true) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| deleted_at | DateTime | нет | Мягкое удаление | — |

---

## Direction

Направление — тип услуги (Английский, Скорочтение, Стрейчинг и т.д.).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| name | String | да | Название направления | — |
| base_lesson_price | Decimal(12,2) | да | Базовая стоимость одного занятия | — |
| trial_price | Decimal(12,2) | да | Стоимость пробного (0 = бесплатное) | — |
| trial_is_free | Boolean | да | Пробное бесплатное (дефолт true) | — |
| default_duration_minutes | Int | да | Длительность занятия по умолчанию (мин) | — |
| is_active | Boolean | да | Активно (дефолт true) | — |
| sort_order | Int | да | Порядок сортировки (дефолт 0) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| deleted_at | DateTime | нет | Мягкое удаление | — |

---

## Employee

Сотрудник — пользователь системы (владелец, управляющий, админ, инструктор, только чтение). Также используется для учёта кандидатов (type = CANDIDATE).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| type | EmployeeType | да | Тип: ACTIVE (сотрудник) / CANDIDATE (кандидат). Дефолт ACTIVE | — |
| role | EmployeeRole | да | Роль (owner / manager / admin / instructor / readonly) | — |
| first_name | String | да | Имя | — |
| last_name | String | да | Фамилия | — |
| patronymic | String | нет | Отчество | — |
| phone | String | нет | Телефон | — |
| email | String | нет | Email (обязателен для владельца) | Уникален в рамках tenant |
| login | String | нет | Логин (латиница, для сотрудников) | Уникален в рамках tenant |
| password_hash | String | нет | Хеш пароля (обязателен для ACTIVE, null для CANDIDATE) | — |
| birth_date | Date | нет | Дата рождения | — |
| hire_date | Date | нет | Дата начала работы | — |
| fire_date | Date | нет | Дата увольнения | — |
| is_active | Boolean | да | Активен (дефолт true) | — |
| can_view_own_salary | Boolean | да | Может видеть свою ЗП (дефолт true, для инструкторов) | — |
| custom_permissions | Json | нет | Настраиваемые права (для управляющего) | — |
| candidate_status | CandidateStatus | нет | Статус кандидата (только для type=CANDIDATE): NEW / INTERVIEW / TRIAL_DAY / HIRED / REJECTED | — |
| interview_history | Json | нет | История собеседований (только для type=CANDIDATE): массив {date, comment} | — |
| resume_url | String | нет | Путь к файлу резюме (только для type=CANDIDATE) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| deleted_at | DateTime | нет | Мягкое удаление | — |

> **Авторизация:** основной аккаунт (владелец) регистрируется по email. Владелец создаёт логины (латиница) + пароли для остальных сотрудников. Сотрудникам email необязателен.

> **Примечание:** При переходе кандидата в статус HIRED: `type` меняется на ACTIVE, `candidate_status` сохраняется как HIRED, `hire_date` заполняется автоматически.

---

## EmployeeBranch

Связь сотрудника с филиалами (доступ по филиалам).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| employee_id | UUID | да | FK → Employee | Сотрудник |
| branch_id | UUID | да | FK → Branch | Филиал |
| created_at | DateTime | да | Дата создания | — |

**Уникальность:** (employee_id, branch_id)

---

## EmployeeDocument

Документы сотрудника (паспорт, трудовой договор, СНИЛС и т.д.).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| employee_id | UUID | да | FK → Employee | Сотрудник |
| name | String | да | Название документа | — |
| file_url | String | да | URL файла (PDF) | — |
| uploaded_at | DateTime | да | Дата загрузки | — |

---

## SalaryRate

Ставка ЗП — привязана к сотруднику + филиалу + направлению + группе (опц.).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| employee_id | UUID | да | FK → Employee | Сотрудник |
| branch_id | UUID | нет | FK → Branch | Филиал (null = все филиалы, для окладной) |
| direction_id | UUID | нет | FK → Direction | Направление (null = все, для окладной) |
| group_id | UUID | нет | FK → Group | Группа (опц., для индивидуальной ставки) |
| type | SalaryRateType | да | Тип: per_student / per_lesson / fixed_plus_per_student / fixed_salary / per_shift | — |
| rate_per_student | Decimal(12,2) | нет | Ставка за ученика | — |
| rate_per_lesson | Decimal(12,2) | нет | Фикс за занятие | — |
| rate_fixed_per_shift | Decimal(12,2) | нет | Фикс за выход | — |
| rate_fixed_salary | Decimal(12,2) | нет | Окладная ЗП (в месяц) | — |
| effective_from | Date | да | Дата начала действия ставки | — |
| effective_to | Date | нет | Дата окончания (null = бессрочно) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| created_by | UUID | нет | FK → Employee | Кто создал |

---

## AdminBonus

Мотивация администратора — бонус за продажи.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| employee_id | UUID | да | FK → Employee | Администратор |
| name | String | да | Название бонуса | — |
| channel_id | UUID | нет | FK → MarketingChannel | Канал (null = любой) |
| condition | String | нет | Описание условия | — |
| amount | Decimal(12,2) | да | Сумма бонуса за одну продажу | — |
| is_active | Boolean | да | Активен (дефолт true) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

---

## Group

Группа — конкретный слот: направление + кабинет + время + инструктор + состав учеников.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| name | String | да | Название группы | — |
| direction_id | UUID | да | FK → Direction | Направление |
| branch_id | UUID | да | FK → Branch | Филиал |
| room_id | UUID | да | FK → Room | Кабинет |
| instructor_id | UUID | да | FK → Employee | Текущий инструктор |
| max_students | Int | да | Лимит учеников | — |
| is_active | Boolean | да | Активна (дефолт true). false = архив | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| deleted_at | DateTime | нет | Мягкое удаление | — |

---

## GroupScheduleTemplate

Шаблон расписания группы — дни + время + длительность для генерации занятий.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| group_id | UUID | да | FK → Group | Группа |
| day_of_week | Int | да | День недели (0=пн, 6=вс) | — |
| start_time | Time | да | Время начала | — |
| duration_minutes | Int | да | Длительность (мин) | — |
| effective_from | Date | да | Дата начала действия шаблона | — |
| effective_to | Date | нет | Дата окончания (null = бессрочно) | — |
| created_at | DateTime | да | Дата создания | — |

---

## Lesson

Занятие — одно конкретное событие в расписании.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| group_id | UUID | да | FK → Group | Группа |
| date | Date | да | Дата занятия | — |
| start_time | Time | да | Время начала | — |
| duration_minutes | Int | да | Длительность (мин) | — |
| instructor_id | UUID | да | FK → Employee | Инструктор (может отличаться от группы при замене) |
| is_trial | Boolean | да | Пробное занятие (дефолт false) | — |
| status | LessonStatus | да | Статус: scheduled / completed / cancelled | — |
| cancel_reason | String | нет | Причина отмены (праздник, каникулы) | — |
| is_makeup | Boolean | да | Занятие-отработка (дефолт false) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

---

## Attendance

Посещение — факт присутствия/отсутствия на занятии.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| lesson_id | UUID | да | FK → Lesson | Занятие |
| subscription_id | UUID | нет | FK → Subscription | Абонемент (для списания) |
| trial_lesson_id | UUID | нет | FK → TrialLesson | Пробное занятие (если посещение по пробному) |
| client_id | UUID | да | FK → Client | Клиент |
| ward_id | UUID | нет | FK → Ward | Подопечный (если есть) |
| attendance_type_id | UUID | да | FK → AttendanceType | Вид дня |
| absence_reason_id | UUID | нет | FK → AbsenceReason | Причина пропуска |
| charge_amount | Decimal(12,2) | да | Сумма списания с абонемента (0 при перерасчёте) | — |
| instructor_pay_amount | Decimal(12,2) | да | Начисление ЗП инструктору | — |
| instructor_pay_enabled | Boolean | да | Оплата инструктору включена (переключатель) | — |
| is_trial | Boolean | да | Пробное посещение (дефолт false) | — |
| marked_by | UUID | нет | FK → Employee | Кто отметил | — |
| marked_at | DateTime | нет | Когда отметили | — |
| is_after_period_close | Boolean | да | Отмечено после закрытия периода (дефолт false) | Аудит |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

**Уникальность:** (lesson_id, subscription_id)

**Ограничение:** Одно из subscription_id или trial_lesson_id должно быть заполнено (CHECK: subscription_id IS NOT NULL OR trial_lesson_id IS NOT NULL).

---

## AttendanceType

Вид дня — справочник (Явка, Прогул, Перерасчёт, Отработка + пользовательские).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | нет | FK → Organization | null = системные (предустановленные) |
| name | String | да | Название (Явка, Прогул, Перерасчёт, Отработка) | — |
| code | String | да | Машинный код (present, absent, recalculation, makeup) | — |
| charges_subscription | Boolean | да | Списывать с абонемента? | — |
| pays_instructor | Boolean | да | Начислять ЗП инструктору? (переопределяется настройкой организации) | — |
| counts_as_revenue | Boolean | да | Считается как выручка? | — |
| is_system | Boolean | да | Системный (нельзя удалить) | — |
| is_active | Boolean | да | Активен (дефолт true) | — |
| sort_order | Int | да | Порядок сортировки (дефолт 0) | — |
| created_at | DateTime | да | Дата создания | — |

---

## Client

Лид / Клиент — единая сущность с двумя потоками: воронка лидов и работа с клиентской базой.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| first_name | String | нет | Имя | — |
| last_name | String | нет | Фамилия | — |
| patronymic | String | нет | Отчество | — |
| phone | String | нет | Телефон (основной). Обязательно: phone ИЛИ social_link | — |
| phone2 | String | нет | Дополнительный телефон | — |
| email | String | нет | Email | — |
| social_link | String | нет | Ссылка VK / Telegram / другое | — |
| funnel_status | FunnelStatus | да | Статус воронки лидов | — |
| client_status | ClientWorkStatus | нет | Статус работы с клиентской базой (null для лидов) | — |
| segment | ClientSegment | да | Сегмент (auto): new / standard / regular / vip (дефолт new) | — |
| total_subscriptions_count | Int | да | Количество купленных абонементов (для сегментации, дефолт 0) | — |
| channel_id | UUID | нет | FK → MarketingChannel | Канал привлечения |
| assigned_to | UUID | нет | FK → Employee | Ответственный менеджер |
| branch_id | UUID | нет | FK → Branch | Предпочтительный филиал |
| next_contact_date | Date | нет | Дата следующего контакта | — |
| blacklist_reason | String | нет | Причина добавления в ЧС | — |
| blacklisted_by | UUID | нет | FK → Employee | Кто добавил в ЧС |
| withdrawal_reason_id | UUID | нет | FK → WithdrawalReason | Причина отчисления |
| withdrawal_date | Date | нет | Дата отчисления (вручную или авто). **Важно:** рассчитывается по дате последнего платного занятия, НЕ по дате заявления клиента | — |
| withdrawal_affects_direction | Boolean | нет | Отток по направлению (для отчётов) | — |
| withdrawal_affects_instructor | Boolean | нет | Отток по педагогу (для отчётов) | — |
| client_balance | Decimal(12,2) | да | Общий баланс клиента (остатки с закрытых абонементов, дефолт 0) | — |
| promised_payment_date | Date | нет | Обещанная дата оплаты (для должников) | — |
| first_payment_date | Date | нет | Дата первой оплаты (автоматически, момент перехода лид→клиент) | — |
| sale_date | Date | нет | Дата продажи (для отчётов доходимости) | — |
| money_ltv | Decimal(12,2) | да | LTV по деньгам: сумма всех оплат клиента (дефолт 0, вычисляемое) | — |
| months_ltv | Int | да | LTV по месяцам: количество купленных абонементов = количество месяцев (дефолт 0, вычисляемое) | — |
| comment | Text | нет | Комментарий | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| created_by | UUID | нет | FK → Employee | Кто создал |
| deleted_at | DateTime | нет | Мягкое удаление | — |

**Валидация:** phone IS NOT NULL OR social_link IS NOT NULL

> **Переход статуса:** funnel_status → client_status: при первой оплате абонемента клиент переходит из воронки лидов в статус ACTIVE. Обратный переход в лида НЕВОЗМОЖЕН (триггер без возврата).

---

## Ward

Подопечный — информационная сущность (ребёнок). Не участвует в финансовой логике.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| client_id | UUID | да | FK → Client | Родитель (клиент) |
| first_name | String | да | Имя | — |
| last_name | String | нет | Фамилия | — |
| birth_date | Date | нет | Дата рождения | — |
| age | Int | нет | Возраст (вычисляемый или на момент создания) | — |
| notes | Text | нет | Произвольные заметки | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

---

## Subscription

Абонемент — предоплата за услуги. Привязан к клиенту, направлению, группе. Каждый месяц — новый.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| client_id | UUID | да | FK → Client | Клиент |
| ward_id | UUID | нет | FK → Ward | Подопечный (опц.) |
| direction_id | UUID | да | FK → Direction | Направление |
| group_id | UUID | да | FK → Group | Группа |
| type | SubscriptionType | да | Тип: calendar / fixed / package (MVP = calendar) | — |
| status | SubscriptionStatus | да | Статус: active / closed / withdrawn | — |
| period_year | Int | да | Год (2026) | — |
| period_month | Int | да | Месяц (1–12) | — |
| lesson_price | Decimal(12,2) | да | Стоимость одного занятия (может быть индивидуальной) | — |
| total_lessons | Int | да | Количество занятий в абонементе | — |
| total_amount | Decimal(12,2) | да | Полная сумма абонемента (до скидок) | — |
| discount_amount | Decimal(12,2) | да | Сумма скидки (дефолт 0) | — |
| final_amount | Decimal(12,2) | да | Итоговая сумма (total_amount - discount_amount) | — |
| balance | Decimal(12,2) | да | Текущий баланс абонемента (дефолт 0) | — |
| charged_amount | Decimal(12,2) | да | Списано всего (сумма charge_amount из Attendance, дефолт 0) | — |
| start_date | Date | да | Дата начала (может быть не 1 число) | — |
| end_date | Date | нет | Дата окончания | — |
| withdrawal_reason_id | UUID | нет | FK → WithdrawalReason | Причина отчисления (при закрытии) |
| withdrawal_date | Date | нет | Дата отчисления | — |
| is_trial_credited | Boolean | да | Стоимость пробного засчитана в абонемент (дефолт false) | — |
| previous_subscription_id | UUID | нет | FK → Subscription | Предыдущий абонемент (для цепочки продлений) |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| created_by | UUID | нет | FK → Employee | Кто создал |
| deleted_at | DateTime | нет | Мягкое удаление | — |

---

## Discount

Скидка — применённая к конкретному абонементу.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| subscription_id | UUID | да | FK → Subscription | Абонемент |
| template_id | UUID | нет | FK → DiscountTemplate | Шаблон скидки (null = ручная) |
| type | DiscountType | да | Тип: permanent / one_time / linked | — |
| value_type | DiscountValueType | да | Тип значения: percent / fixed | — |
| value | Decimal(12,2) | да | Величина скидки (% или руб.) | — |
| calculated_amount | Decimal(12,2) | да | Рассчитанная сумма скидки в рублях | — |
| linked_client_id | UUID | нет | FK → Client | Клиент-основание (для связанной скидки) |
| linked_subscription_id | UUID | нет | FK → Subscription | Абонемент-основание (для связанной) |
| comment | String | нет | Комментарий | — |
| start_date | Date | да | Начало действия | — |
| end_date | Date | нет | Конец действия (null = бессрочно) | — |
| is_active | Boolean | да | Активна (дефолт true) | — |
| created_at | DateTime | да | Дата создания | — |
| created_by | UUID | нет | FK → Employee | Кто создал |

---

## DiscountTemplate

Шаблон скидки — предопределённые типы скидок организации.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| name | String | да | Название скидки | — |
| type | DiscountType | да | Тип: permanent / one_time / linked | — |
| value_type | DiscountValueType | да | Тип значения: percent / fixed | — |
| value | Decimal(12,2) | да | Величина скидки (% или руб.) | — |
| is_stackable | Boolean | да | Можно суммировать с другими (дефолт false) | — |
| is_active | Boolean | да | Активен (дефолт true) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

---

## Payment

Платёж — оплата от клиента или возврат.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| client_id | UUID | да | FK → Client | Клиент |
| subscription_id | UUID | нет | FK → Subscription | Абонемент (null = на баланс клиента) |
| account_id | UUID | да | FK → Account | Счёт/касса | — |
| amount | Decimal(12,2) | да | Сумма (положительная = приход, отрицательная = возврат) | — |
| type | PaymentType | да | Тип: incoming / refund / transfer_in | — |
| method | PaymentMethod | да | Способ: cash / bank_transfer / acquiring / online_yukassa / online_robokassa / sbp_qr | — |
| date | Date | да | Дата платежа | — |
| comment | String | нет | Комментарий | — |
| is_first_payment | Boolean | да | Первая оплата (триггер лид→клиент, дефолт false) | — |
| online_payment_id | String | нет | ID транзакции ЮKassa/Робокасса | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| created_by | UUID | нет | FK → Employee | Кто создал |
| deleted_at | DateTime | нет | Мягкое удаление | — |

---

## Account

Счёт / Кошелёк — место хранения денег (касса наличных, расчётный счёт, эквайринг, онлайн).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| name | String | да | Название (Касса 1, Р/с Сбербанк и т.д.) | — |
| type | AccountType | да | Тип: cash / bank_account / acquiring / online | — |
| branch_id | UUID | нет | FK → Branch | Привязка к филиалу (null = организация) |
| room_id | UUID | нет | FK → Room | Привязка к кабинету (опц.) |
| balance | Decimal(12,2) | да | Текущий остаток (дефолт 0) | — |
| is_active | Boolean | да | Активен (дефолт true) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| deleted_at | DateTime | нет | Мягкое удаление | — |

---

## AccountOperation

Внутренняя кассовая операция — изъятие, инкассация, перемещение между счетами.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| type | AccountOperationType | да | Тип операции | — |
| from_account_id | UUID | нет | FK → Account | Счёт-источник |
| to_account_id | UUID | нет | FK → Account | Счёт-получатель |
| amount | Decimal(12,2) | да | Сумма | — |
| date | Date | да | Дата операции | — |
| description | String | нет | Описание/комментарий | — |
| created_by | UUID | да | FK → Employee | Кто создал |
| created_at | DateTime | да | — | — |
| updated_at | DateTime | да | — | — |
| deleted_at | DateTime | нет | Мягкое удаление | — |

---

## AccountTransfer

Перемещение между счетами/кассами.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| from_account_id | UUID | да | FK → Account | Счёт-источник |
| to_account_id | UUID | да | FK → Account | Счёт-получатель |
| amount | Decimal(12,2) | да | Сумма перемещения | — |
| date | Date | да | Дата | — |
| comment | String | нет | Комментарий | — |
| created_at | DateTime | да | Дата создания | — |
| created_by | UUID | нет | FK → Employee | Кто создал |

---

## Expense

Расход — операционные расходы организации.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| category_id | UUID | да | FK → ExpenseCategory | Статья расхода |
| account_id | UUID | да | FK → Account | Оплачено из счёта |
| amount | Decimal(12,2) | да | Полная сумма расхода | — |
| date | Date | да | Дата расхода | — |
| comment | String | нет | Комментарий | — |
| amortization_months | Int | нет | Период амортизации (null = без амортизации). ДДС = полная сумма, финрез = 1/N | — |
| amortization_start_date | Date | нет | Дата начала амортизации | — |
| is_variable | Boolean | да | Переменный расход (ЗП, материалы) vs постоянный | — |
| is_recurring | Boolean | да | Повторяющийся расход (копируется ежемесячно, дефолт false) | — |
| recurring_group_id | UUID | нет | Группировка повторяющихся расходов | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| created_by | UUID | нет | FK → Employee | Кто создал |
| deleted_at | DateTime | нет | Мягкое удаление | — |

---

## ExpenseBranch

Привязка расхода к филиалам (один/несколько/все).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| expense_id | UUID | да | FK → Expense | Расход |
| branch_id | UUID | нет | FK → Branch | Филиал (null = все филиалы) |
| direction_id | UUID | нет | FK → Direction | Направление (null = все) |
| room_id | UUID | нет | FK → Room | Кабинет (опц.) |

---

## ExpenseCategory

Статья расхода — справочник (14 предустановленных + пользовательские).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | нет | FK → Organization | null = системные (предустановленные) |
| name | String | да | Название | — |
| is_salary | Boolean | да | Категория зарплаты (для выделения в финрезе) | — |
| is_variable | Boolean | да | Переменный расход (для маржинальности) | — |
| is_system | Boolean | да | Системная (нельзя удалить) | — |
| is_active | Boolean | да | Активна (дефолт true) | — |
| sort_order | Int | да | Порядок (дефолт 0) | — |
| created_at | DateTime | да | Дата создания | — |

---

## PlannedExpense

Плановый расход — план платежей (копирование с прошлого месяца).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| category_id | UUID | да | FK → ExpenseCategory | Статья расхода |
| employee_id | UUID | нет | FK → Employee | Сотрудник (для ЗП) |
| branch_id | UUID | нет | FK → Branch | Филиал |
| period_year | Int | да | Год | — |
| period_month | Int | да | Месяц | — |
| planned_amount | Decimal(12,2) | да | Плановая сумма | — |
| paid_amount | Decimal(12,2) | да | Оплаченная сумма (дефолт 0) | — |
| comment | String | нет | Комментарий | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

---

## SalaryPayment

Выплата ЗП сотруднику.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| employee_id | UUID | да | FK → Employee | Сотрудник |
| account_id | UUID | да | FK → Account | Из какого счёта |
| amount | Decimal(12,2) | да | Сумма выплаты | — |
| date | Date | да | Дата выплаты | — |
| period_year | Int | да | За какой год | — |
| period_month | Int | да | За какой месяц | — |
| period_half | Int | нет | Половина месяца (1 = 1–15, 2 = 16–31, null = весь месяц) | — |
| comment | String | нет | Комментарий | — |
| created_at | DateTime | да | Дата создания | — |
| created_by | UUID | нет | FK → Employee | Кто провёл |

---

## SalaryAdjustment

Премия / штраф сотрудника.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| employee_id | UUID | да | FK → Employee | Сотрудник |
| type | AdjustmentType | да | Тип: bonus / penalty | — |
| amount | Decimal(12,2) | да | Сумма (всегда положительная) | — |
| period_year | Int | да | Год | — |
| period_month | Int | да | Месяц | — |
| period_half | Int | нет | Половина месяца (1/2/null) | — |
| comment | String | да | Комментарий (обязателен) | — |
| created_at | DateTime | да | Дата создания | — |
| created_by | UUID | нет | FK → Employee | Кто создал |

---

## SalaryAccrual

Начисление ЗП — детализация по каждому занятию (автоматическое при отметке посещений).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| employee_id | UUID | да | FK → Employee | Инструктор |
| lesson_id | UUID | да | FK → Lesson | Занятие |
| attendance_id | UUID | нет | FK → Attendance | Посещение (null для фикс-ставки) |
| salary_rate_id | UUID | нет | FK → SalaryRate | Применённая ставка |
| amount | Decimal(12,2) | да | Сумма начисления | — |
| is_override | Boolean | да | Ручная корректировка ставки (дефолт false) | — |
| override_amount | Decimal(12,2) | нет | Ручная сумма (если is_override) | — |
| is_after_period_close | Boolean | да | Начислено после закрытия периода (дефолт false) | Аудит |
| created_at | DateTime | да | Дата создания | — |

---

## WithdrawalReason

Причина отчисления — справочник (7 предустановленных + пользовательские).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | нет | FK → Organization | null = системные | — |
| name | String | да | Название причины | — |
| is_course_completed | Boolean | да | Тип: «Закончил курс» vs «Ушёл с направления» (для отчёта оттока) | — |
| is_system | Boolean | да | Системная (нельзя удалить) | — |
| is_active | Boolean | да | Активна (дефолт true) | — |
| sort_order | Int | да | Порядок (дефолт 0) | — |
| created_at | DateTime | да | Дата создания | — |

---

## AbsenceReason

Причина пропуска — справочник (7 предустановленных + пользовательские).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | нет | FK → Organization | null = системные |
| name | String | да | Название причины | — |
| is_system | Boolean | да | Системная (нельзя удалить) | — |
| is_active | Boolean | да | Активна (дефолт true) | — |
| sort_order | Int | да | Порядок (дефолт 0) | — |
| created_at | DateTime | да | Дата создания | — |

---

## MarketingChannel

Канал привлечения — справочник (13 предустановленных + пользовательские).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | нет | FK → Organization | null = системные |
| name | String | да | Название канала | — |
| is_system | Boolean | да | Системная (нельзя удалить) | — |
| is_active | Boolean | да | Активна (дефолт true) | — |
| sort_order | Int | да | Порядок (дефолт 0) | — |
| created_at | DateTime | да | Дата создания | — |

---

## StockItem

Товар на складе — номенклатура.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| name | String | да | Наименование товара | — |
| unit | String | да | Единица измерения (шт, кг, пачка) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| deleted_at | DateTime | нет | Мягкое удаление | — |

---

## StockBalance

Остаток товара на складе филиала.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| stock_item_id | UUID | да | FK → StockItem | Товар |
| branch_id | UUID | да | FK → Branch | Филиал (склад) |
| quantity | Decimal(10,3) | да | Количество (дефолт 0) | — |
| total_cost | Decimal(12,2) | да | Общая стоимость (дефолт 0) | — |
| updated_at | DateTime | да | Дата обновления | — |

**Уникальность:** (stock_item_id, branch_id)

---

## StockMovement

Перемещение склада — закупка, перемещение склад→кабинет, списание.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| stock_item_id | UUID | да | FK → StockItem | Товар |
| type | StockMovementType | да | Тип: purchase / transfer_to_room / write_off | — |
| quantity | Decimal(10,3) | да | Количество | — |
| unit_cost | Decimal(12,2) | нет | Стоимость за единицу | — |
| total_cost | Decimal(12,2) | да | Общая стоимость | — |
| from_branch_id | UUID | нет | FK → Branch | Склад-источник | — |
| to_room_id | UUID | нет | FK → Room | Кабинет-получатель | — |
| expense_id | UUID | нет | FK → Expense | Связанный расход (при закупке) | — |
| amortization_months | Int | нет | Амортизация при закупке (N месяцев) | — |
| date | Date | да | Дата перемещения | — |
| comment | String | нет | Комментарий | — |
| created_at | DateTime | да | Дата создания | — |
| created_by | UUID | нет | FK → Employee | Кто создал |

---

## RoomBalance

Баланс кабинета — что лежит в кабинете (товары).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| room_id | UUID | да | FK → Room | Кабинет |
| stock_item_id | UUID | да | FK → StockItem | Товар |
| quantity | Decimal(10,3) | да | Количество (дефолт 0) | — |
| total_cost | Decimal(12,2) | да | Общая стоимость (дефолт 0) | — |
| updated_at | DateTime | да | Дата обновления | — |

**Уникальность:** (room_id, stock_item_id)

---

## Task

Задача — ручная или автоматическая.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| title | String | да | Заголовок задачи | — |
| description | Text | нет | Описание | — |
| type | TaskType | да | Тип: manual / auto | — |
| auto_trigger | TaskAutoTrigger | нет | Триггер: contact_date / trial_reminder / payment_due / birthday / absence / promised_payment | — |
| status | TaskStatus | да | Статус: pending / completed / cancelled | — |
| due_date | Date | да | Дата исполнения | — |
| priority | Int | да | Приоритет (вычисляемый по близости даты) | — |
| assigned_to | UUID | да | FK → Employee | Исполнитель |
| assigned_by | UUID | нет | FK → Employee | Кто назначил (для ручных) |
| client_id | UUID | нет | FK → Client | Связанный клиент |
| subscription_id | UUID | нет | FK → Subscription | Связанный абонемент |
| lesson_id | UUID | нет | FK → Lesson | Связанное занятие |
| template_id | UUID | нет | FK → TaskTemplate | Шаблон (для циклических) |
| completed_at | DateTime | нет | Когда выполнена | — |
| completed_by | UUID | нет | FK → Employee | Кто выполнил |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| deleted_at | DateTime | нет | Мягкое удаление | — |

---

## TaskTemplate

Шаблон циклической задачи.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| title | String | да | Заголовок | — |
| description | Text | нет | Описание | — |
| auto_trigger | TaskAutoTrigger | да | Триггер | — |
| days_before | Int | да | За сколько дней до события (дефолт 0) | — |
| assigned_to | UUID | нет | FK → Employee | Исполнитель по умолчанию |
| is_active | Boolean | да | Активен (дефолт true) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

---

## CallCampaign

Кампания обзвона.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| name | String | да | Название кампании | — |
| status | CallCampaignStatus | да | Статус: active / closed / archived | — |
| filter_criteria | Json | да | Критерии фильтра (статус, возраст, филиал) | — |
| assigned_to | UUID | нет | FK → Employee | Ответственный | — |
| total_items | Int | да | Всего в списке (дефолт 0) | — |
| completed_items | Int | да | Обзвонено (дефолт 0) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| created_by | UUID | нет | FK → Employee | Кто создал |
| deleted_at | DateTime | нет | Мягкое удаление | — |

---

## CallCampaignItem

Элемент обзвона — один контакт в кампании.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| campaign_id | UUID | да | FK → CallCampaign | Кампания |
| client_id | UUID | да | FK → Client | Клиент |
| status | CallItemStatus | да | Статус: pending / called / no_answer / callback / completed | — |
| contact_date | Date | нет | Дата связи | — |
| comment | Text | нет | Комментарий | — |
| result | String | нет | Результат звонка | — |
| called_by | UUID | нет | FK → Employee | Кто звонил |
| called_at | DateTime | нет | Когда позвонили | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

---

## CommunicationLog

История коммуникации — лента (кто, когда, комментарий, дата след. контакта). Не удаляемая.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| client_id | UUID | да | FK → Client | Клиент |
| employee_id | UUID | да | FK → Employee | Кто контактировал |
| type | CommunicationType | да | Тип: call / message / meeting / note / system | — |
| comment | Text | да | Комментарий | — |
| next_contact_date | Date | нет | Дата следующего контакта | — |
| call_campaign_item_id | UUID | нет | FK → CallCampaignItem | Из обзвона (если есть) |
| created_at | DateTime | да | Дата создания (не удаляется!) | — |

---

## AuditLog

Лог действий — кто, когда, что изменил. Хранение минимум 3 месяца. Без откатов.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| employee_id | UUID | да | FK → Employee | Кто совершил действие |
| action | String | да | Действие (create / update / delete) | — |
| entity_type | String | да | Тип сущности (Attendance, Payment, Expense...) | — |
| entity_id | UUID | да | ID изменённой записи | — |
| changes | Json | да | Изменённые поля {field: {old, new}} | — |
| is_after_period_close | Boolean | да | Изменение после закрытия периода (дефолт false) | — |
| ip_address | String | нет | IP-адрес | — |
| user_agent | String | нет | User-Agent | — |
| created_at | DateTime | да | Дата действия | — |

---

## Period

Учётный период — мягкое закрытие месяца.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| year | Int | да | Год | — |
| month | Int | да | Месяц (1–12) | — |
| status | PeriodStatus | да | Статус: open / closed / reopened | — |
| closed_at | DateTime | нет | Когда закрыт | — |
| closed_by | UUID | нет | FK → Employee | Кто закрыл |
| reopened_at | DateTime | нет | Когда переоткрыт | — |
| reopened_by | UUID | нет | FK → Employee | Кто переоткрыл |
| snapshot | Json | нет | Снимок финреза на момент закрытия | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

**Уникальность:** (tenant_id, year, month)

---

## DashboardWidget

Виджет дашборда — настраиваемый главный экран.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| employee_id | UUID | да | FK → Employee | Пользователь |
| widget_type | String | да | Тип виджета (tasks, debtors, funnel, revenue, schedule...) | — |
| position | Int | да | Позиция на экране | — |
| settings | Json | нет | Настройки виджета (фильтры, вид) | — |
| is_visible | Boolean | да | Показывать (дефолт true) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

---

## Notification

Уведомление (пустые группы, неотмеченные занятия, просроченные оплаты).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| employee_id | UUID | да | FK → Employee | Кому |
| type | NotificationType | да | Тип: empty_group / unmarked_lesson / overdue_payment / trial_reminder / period_close | — |
| title | String | да | Заголовок | — |
| message | Text | нет | Текст | — |
| entity_type | String | нет | Связанная сущность | — |
| entity_id | UUID | нет | ID связанной записи | — |
| is_read | Boolean | да | Прочитано (дефолт false) | — |
| created_at | DateTime | да | Дата создания | — |

---

## ProductionCalendar

Производственный календарь — праздничные и рабочие дни.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| date | Date | да | Дата | — |
| is_working | Boolean | да | Рабочий день | — |
| comment | String | нет | Комментарий (название праздника) | — |
| created_at | DateTime | да | Дата создания | — |

**Уникальность:** (tenant_id, date)

---

## InstructorSubstitution

Замена инструктора — разовая или постоянная.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| group_id | UUID | да | FK → Group | Группа |
| original_instructor_id | UUID | да | FK → Employee | Исходный инструктор |
| substitute_instructor_id | UUID | да | FK → Employee | Заменяющий инструктор |
| type | SubstitutionType | да | Тип: one_time / permanent | — |
| lesson_id | UUID | нет | FK → Lesson | Конкретное занятие (для разовой) |
| effective_from | Date | нет | С какой даты (для постоянной) | — |
| created_at | DateTime | да | Дата создания | — |
| created_by | UUID | нет | FK → Employee | Кто назначил |

---

## TrialLesson

Пробное занятие — связь лида с группой и датой пробного.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| client_id | UUID | да | FK → Client | Лид/клиент |
| ward_id | UUID | нет | FK → Ward | Подопечный |
| group_id | UUID | да | FK → Group | Группа |
| lesson_id | UUID | нет | FK → Lesson | Конкретное занятие (после назначения) |
| direction_id | UUID | да | FK → Direction | Направление |
| scheduled_date | Date | да | Дата пробного | — |
| status | TrialStatus | да | Статус: scheduled / attended / no_show / cancelled | — |
| is_paid | Boolean | да | Платное пробное | — |
| paid_amount | Decimal(12,2) | нет | Сумма оплаты пробного | — |
| payment_id | UUID | нет | FK → Payment | Оплата пробного занятия |
| result_comment | String | нет | Комментарий по результату | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| created_by | UUID | нет | FK → Employee | Кто назначил |
| deleted_at | DateTime | нет | Мягкое удаление | — |

> **Примечание:** TrialLesson — единый источник истины для данных о пробных занятиях. Все данные о пробных (дата, группа, оплата, результат) хранятся здесь.

---

## ClientMergeLog

Журнал объединения дубликатов клиентов.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| primary_client_id | UUID | да | FK → Client | Основная запись (оставшаяся) |
| merged_client_id | UUID | да | ID удалённой записи (soft delete) |
| merged_data | Json | да | Снимок данных удалённого клиента | — |
| merged_at | DateTime | да | Когда объединили | — |
| merged_by | UUID | да | FK → Employee | Кто объединил |

---

## WaitlistEntry

Лист ожидания (v2) — клиент ждёт место в группе.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| client_id | UUID | да | FK → Client | Клиент |
| ward_id | UUID | нет | FK → Ward | Подопечный |
| group_id | UUID | нет | FK → Group | Желаемая группа |
| direction_id | UUID | да | FK → Direction | Направление |
| preferred_time | String | нет | Желаемое время | — |
| preferred_instructor_id | UUID | нет | FK → Employee | Желаемый инструктор |
| status | WaitlistStatus | да | Статус: waiting / notified / enrolled / cancelled | — |
| comment | String | нет | Комментарий | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

---

## GroupEnrollment

Зачисление ученика в группу — связь подопечного/абонемента с группой.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| group_id | UUID | да | FK → Group | Группа |
| client_id | UUID | да | FK → Client | Клиент |
| ward_id | UUID | нет | FK → Ward | Подопечный |
| subscription_id | UUID | нет | FK → Subscription | Текущий абонемент |
| selected_days | Json | нет | Выбранные дни недели (null = все дни группы). Формат: [0,2] где 0=Пн, 2=Ср | — |
| enrolled_at | Date | да | Дата зачисления | — |
| withdrawn_at | Date | нет | Дата отчисления из группы | — |
| is_active | Boolean | да | Активен в группе (дефолт true) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |
| deleted_at | DateTime | нет | Мягкое удаление | — |

---

## UnprolongedComment

Комментарий администратора по непродлённому абонементу (отчёт «Непродлённые»).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| client_id | UUID | да | FK → Client | Клиент |
| subscription_id | UUID | да | FK → Subscription | Абонемент (прошлый месяц) |
| period_year | Int | да | Год текущего периода | — |
| period_month | Int | да | Месяц текущего периода | — |
| comment | Text | да | Комментарий администратора | — |
| created_at | DateTime | да | Дата создания | — |
| created_by | UUID | нет | FK → Employee | Кто добавил |

---

## ClientBalanceTransaction

Транзакция баланса клиента — пополнение, списание, перенос остатков.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| client_id | UUID | да | FK → Client | Клиент |
| amount | Decimal(12,2) | да | Сумма (+ пополнение, − списание) | — |
| type | BalanceTransactionType | да | Тип операции | — |
| subscription_id | UUID | нет | FK → Subscription | Связанный абонемент |
| description | String | нет | Комментарий | — |
| created_by | UUID | нет | FK → Employee | Кто создал |
| created_at | DateTime | да | — | — |

---

## ClientDocument

Документы клиента — прикреплённые файлы.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | — |
| client_id | UUID | да | FK → Client | — |
| name | String | да | Название документа | — |
| file_url | String | да | Путь к файлу | — |
| uploaded_by | UUID | да | FK → Employee | — |
| created_at | DateTime | да | — | — |

---

## IntegrationSettings

Настройки интеграции — API-ключи платёжных систем и других сервисов.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | — |
| provider | IntegrationProvider | да | Тип интеграции | — |
| settings | Json | да | Настройки (API-ключи, зашифрованные) | — |
| is_active | Boolean | да | Включена (дефолт false) | — |
| created_at | DateTime | да | — | — |
| updated_at | DateTime | да | — | — |

> **Миграция:** поля yukassa_shop_id, yukassa_secret_key, robokassa_login, robokassa_password1, robokassa_password2 переносятся из Organization в IntegrationSettings.

---

## AdminBonusSettings

Настройки бонусов администратора — мотивация за продажи, пробные, допродажи.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | — |
| branch_id | UUID | нет | FK → Branch | null = все филиалы |
| employee_id | UUID | да | FK → Employee | Администратор |
| bonus_type | AdminBonusType | да | Тип бонуса | — |
| amount | Decimal(12,2) | да | Сумма бонуса за единицу | — |
| channels | Json | нет | Массив каналов, за которые начисляется | — |
| is_active | Boolean | да | Активна (дефолт true) | — |
| created_at | DateTime | да | — | — |
| updated_at | DateTime | да | — | — |

---

# SaaS-слой (бэк-офис)

Сущности, не привязанные к tenant_id — уровень платформы CRMka.

---

## TariffPlan

Тарифный план SaaS.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| name | String | да | Название тарифа | — |
| price_per_branch | Decimal(12,2) | да | Стоимость за филиал в месяц | — |
| description | Text | нет | Описание | — |
| is_active | Boolean | да | Активен (дефолт true) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

---

## Invoice

Счёт на оплату SaaS — выставляется партнёру.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| organization_id | UUID | да | FK → Organization | Партнёр |
| tariff_plan_id | UUID | да | FK → TariffPlan | Тариф |
| number | String | да | Номер счёта | — |
| amount | Decimal(12,2) | да | Сумма | — |
| branches_count | Int | да | Количество филиалов на момент выставления | — |
| period_from | Date | да | Период «с» | — |
| period_to | Date | да | Период «по» | — |
| status | InvoiceStatus | да | Статус: issued / paid / overdue / cancelled | — |
| issued_at | DateTime | да | Дата выставления | — |
| paid_at | DateTime | нет | Дата оплаты | — |
| payment_method | String | нет | Способ оплаты | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

---

## BackofficeUser

Пользователь бэк-офиса (команда CRMka). Отдельно от Employee.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| email | String | да | Email (логин), уникален | — |
| password_hash | String | да | Хеш пароля | — |
| name | String | да | ФИО | — |
| role | BackofficeRole | да | Роль: superadmin / support / developer / billing | — |
| is_active | Boolean | да | Активен (дефолт true) | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

---

## BackofficeAccessLog

Логирование каждого входа в данные партнёра.

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| backoffice_user_id | UUID | да | FK → BackofficeUser | Кто |
| organization_id | UUID | да | FK → Organization | В данные какого партнёра |
| action | String | да | Действие (view, edit, export) | — |
| reason | String | нет | Причина (номер тикета) | — |
| ip_address | String | нет | IP-адрес | — |
| created_at | DateTime | да | Дата действия | — |

---

## SupportTicket

Тикет поддержки (v2).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| organization_id | UUID | да | FK → Organization | Партнёр |
| subject | String | да | Тема | — |
| description | Text | да | Описание | — |
| status | TicketStatus | да | Статус: open / in_progress / resolved / closed | — |
| priority | TicketPriority | да | Приоритет: low / medium / high / critical | — |
| assigned_to | UUID | нет | FK → BackofficeUser | Ответственный |
| resolved_at | DateTime | нет | Когда решён | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

---

## ClientPortalUser

Пользователь личного кабинета клиента (родитель).

| Поле | Тип | Обязательное | Описание | Связь |
|---|---|---|---|---|
| id | UUID | да | PK | — |
| tenant_id | UUID | да | FK → Organization | Мультитенант |
| client_id | UUID | да | FK → Client | Клиент в CRM |
| phone | String | нет | Телефон (логин) | — |
| email | String | нет | Email | — |
| password_hash | String | нет | Хеш пароля | — |
| is_active | Boolean | да | Активен (дефолт true) | — |
| last_login_at | DateTime | нет | Последний вход | — |
| created_at | DateTime | да | Дата создания | — |
| updated_at | DateTime | да | Дата обновления | — |

---

# Перечисления (Enums)

## OrgStatus
`active` | `suspended` | `blocked` | `archived`

## OnboardingStatus
`not_started` | `in_progress` | `completed`

## NegativeBalanceAction
`block_attendance` | `notify_only`

## EmployeeRole
`owner` | `manager` | `admin` | `instructor` | `readonly`

## SalaryRateType
`per_student` | `per_lesson` | `fixed_plus_per_student` | `fixed_salary` | `per_shift`

## SubscriptionType
`calendar` | `fixed` | `package`

## SubscriptionStatus
`pending` | `active` | `closed` | `withdrawn`

## FunnelStatus
`new` | `trial_scheduled` | `trial_attended` | `awaiting_payment` | `active_client` | `potential` | `non_target` | `blacklisted` | `archived`

## ClientWorkStatus
`active` | `upsell` | `churned` | `returning` | `archived`

## ClientSegment
`new` | `standard` | `regular` | `vip`

## PaymentType
`incoming` | `refund` | `transfer_in`

## PaymentMethod
`cash` | `bank_transfer` | `acquiring` | `online_yukassa` | `online_robokassa` | `sbp_qr`

## AccountType
`cash` | `bank_account` | `acquiring` | `online`

## LessonStatus
`scheduled` | `completed` | `cancelled`

## DiscountType
`permanent` | `one_time` | `linked`

## DiscountValueType
`percent` | `fixed`

## StockMovementType
`purchase` | `transfer_to_room` | `write_off`

## TaskType
`manual` | `auto`

## TaskAutoTrigger
`contact_date` | `trial_reminder` | `payment_due` | `birthday` | `absence` | `promised_payment` | `unmarked_lesson`

## TaskStatus
`pending` | `completed` | `cancelled`

## CallCampaignStatus
`active` | `closed` | `archived`

## CallItemStatus
`pending` | `called` | `no_answer` | `callback` | `completed`

## CommunicationType
`call` | `message` | `meeting` | `note` | `system`

## PeriodStatus
`open` | `closed` | `reopened`

## AdjustmentType
`bonus` | `penalty`

## EmployeeType
`ACTIVE` | `CANDIDATE`

## CandidateStatus
`NEW` | `INTERVIEW` | `TRIAL_DAY` | `HIRED` | `REJECTED`

## SubstitutionType
`one_time` | `permanent`

## TrialStatus
`scheduled` | `attended` | `no_show` | `cancelled`

## WaitlistStatus
`waiting` | `notified` | `enrolled` | `cancelled`

## AccountOperationType
`owner_withdrawal` | `encashment` | `transfer`

## BalanceTransactionType
`subscription_remainder` | `refund` | `correction` | `transfer_to_subscription`

## IntegrationProvider
`yukassa` | `robokassa`

## AdminBonusType
`per_trial` | `per_sale` | `per_upsale`

## NotificationType
`empty_group` | `unmarked_lesson` | `overdue_payment` | `trial_reminder` | `period_close` | `linked_discount_warning`

## InvoiceStatus
`issued` | `paid` | `overdue` | `cancelled`

## BackofficeRole
`superadmin` | `support` | `developer` | `billing`

## TicketStatus
`open` | `in_progress` | `resolved` | `closed`

## TicketPriority
`low` | `medium` | `high` | `critical`

---

# Структуры JSON-полей

### Employee.custom_permissions
Настройки прав роли. Формат:
```json
{
  "can_view_salaries": true,
  "can_edit_after_close": false,
  "can_manage_blacklist": true,
  "can_view_finance": true,
  "can_manage_staff": false,
  "accessible_branches": ["uuid1", "uuid2"] // null = все
}
```

### CallCampaign.filter_criteria
Критерии фильтрации для обзвона. Формат:
```json
{
  "statuses": ["active", "potential"],
  "age_from": 5,
  "age_to": 7,
  "branches": ["uuid1"],
  "directions": ["uuid2"],
  "segments": ["new", "standard"]
}
```

### Period.snapshot
Снимок финансовых данных при закрытии периода. Формат:
```json
{
  "revenue": 450000,
  "expenses": 320000,
  "profit": 130000,
  "active_subscriptions": 87,
  "active_clients": 65,
  "salary_total": 180000,
  "closed_at": "2026-03-31T23:59:59Z",
  "closed_by": "employee_uuid"
}
```

### DashboardWidget.settings
Настройки виджета дашборда. Формат:
```json
{
  "widget_type": "debtors",
  "branch_id": "uuid or null",
  "period": "today | week | month",
  "show_chart": true,
  "limit": 10
}
```

---

# Индексы (рекомендации)

Ключевые индексы для производительности:

1. **Все таблицы:** `(tenant_id)` — RLS фильтрация
2. **Client:** `(tenant_id, phone)` — поиск дублей, `(tenant_id, funnel_status)` — воронка, `(tenant_id, next_contact_date)` — задачи
3. **Attendance:** `(tenant_id, lesson_id)`, `(tenant_id, subscription_id)`, `(tenant_id, marked_at)` — отчёты по периодам
4. **Lesson:** `(tenant_id, group_id, date)`, `(tenant_id, date)` — расписание
5. **Subscription:** `(tenant_id, client_id, status)`, `(tenant_id, period_year, period_month)` — отчёты
6. **Payment:** `(tenant_id, client_id)`, `(tenant_id, date)`, `(tenant_id, account_id, date)` — ДДС
7. **Expense:** `(tenant_id, date)`, `(tenant_id, category_id)` — финрез
8. **SalaryAccrual:** `(tenant_id, employee_id, lesson_id)` — расчёт ЗП
9. **CommunicationLog:** `(tenant_id, client_id, created_at)` — лента
10. **AuditLog:** `(tenant_id, entity_type, entity_id)`, `(tenant_id, created_at)` — аудит
11. **Period:** `(tenant_id, year, month)` UNIQUE — закрытие периода
12. **Task:** `(tenant_id, assigned_to, status, due_date)` — дашборд задач
13. **AccountOperation:** `(tenant_id, date, type)` — кассовые операции
14. **ClientBalanceTransaction:** `(tenant_id, client_id, created_at)` — история баланса клиента
15. **Expense:** `(tenant_id, is_recurring)` — повторяющиеся расходы
16. **Payment:** `(tenant_id, created_at)` — ДДС по дням
