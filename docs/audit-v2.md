# Аудит PRD vs Реализация v2

Дата: 2026-04-08
Аудитор: AI-агент
Источники: PRD v2.5, screens.md, data-dictionary.md, исходный код

## Сводка

| Модуль | DONE | PARTIAL | NOT_DONE | Всего |
|---|---|---|---|---|
| CRM (воронка, клиенты) | 30 | 4 | 4 | 38 |
| Расписание | 7 | 5 | 4 | 16 |
| Посещения | 11 | 1 | 1 | 13 |
| Абонементы | 8 | 3 | 3 | 14 |
| Финансы | 24 | 5 | 2 | 31 |
| Зарплата | 13 | 3 | 1 | 17 |
| Дашборд + задачи | 6 | 1 | 0 | 7 |
| Обзвон | 4 | 1 | 0 | 5 |
| Склад | 0 | 0 | 5 | 5 |
| Администрирование | 8 | 4 | 3 | 15 |
| Кандидаты | 0 | 0 | 4 | 4 |
| Бэк-офис SaaS | 5 | 0 | 0 | 5 |
| Личные кабинеты | 2 | 0 | 0 | 2 |
| **ИТОГО** | **118** | **27** | **27** | **172** |

**Процент готовности:** 69% DONE, 16% PARTIAL, 15% NOT_DONE

---

## Модуль CRM (воронка, клиенты, отчёты)

| ID | Описание | Приоритет | Статус | Комментарий |
|---|---|---|---|---|
| CRM-01 | Карточка лида/клиента: ФИО, телефон, соцсети | MVP | DONE | Client модель; /crm/clients/[id], /crm/leads |
| CRM-02 | История коммуникации: лента | MVP | NOT_DONE | Нет модели Communication. Критично для CRM |
| CRM-03 | Подопечные: имя, возраст, ДР | MVP | DONE | Ward модель; /api/clients/[id]/wards |
| CRM-04 | Воронка лидов: статусы | MVP | DONE | FunnelStatus enum; /crm/leads |
| CRM-05 | Работа с клиентской базой: допродажи/возвраты | MVP | PARTIAL | ClientWorkStatus есть, UI допродажи нет |
| CRM-06 | Дата следующего контакта → задача | MVP | DONE | nextContactDate + /api/tasks/generate |
| CRM-07 | Канал привлечения — справочник | MVP | PARTIAL | channelId есть, справочник хардкод |
| CRM-08 | Автозадачи из дат | MVP | DONE | /api/tasks/generate — 5 триггеров |
| CRM-09 | Фильтрация воронки | MVP | DONE | /crm/leads с фильтрами |
| CRM-10 | Защита от дублей по телефону | MVP | PARTIAL | Поиск есть, предупреждение нет |
| CRM-11 | Чёрный список | MVP | DONE | funnelStatus=blacklisted |
| CRM-12 | Объединение дубликатов | v1.1 | NOT_DONE | Нет API merge |
| CRM-13 | Отчёт «Воронка продаж» | MVP | DONE | /api/reports/funnel |
| CRM-14 | Отчёт «Конверсия пробных по инструкторам» | MVP | DONE | /api/reports/trial-conversion |
| CRM-15 | Отчёт «Лиды по каналам и менеджерам» | MVP | DONE | /api/reports/leads-by-manager |
| CRM-16 | Отчёт «Доходимость» | MVP | DONE | /api/reports/reachability |
| CRM-17 | Отчёт «Допродажи и возвраты» | MVP | NOT_DONE | Нет API |
| CRM-18 | Автосортировка лидов по дате контакта | MVP | PARTIAL | nextContactDate есть, сортировка на UI нет |
| CRM-19 | Сегментация клиентов | MVP | DONE | ClientSegment enum; /api/reports/client-segmentation |
| CRM-20 | Модуль обзвона | MVP | DONE | CallCampaign; /crm/calls |
| CRM-21 | Подсветка статусов пробников | MVP | DONE | Цвета статусов на /crm/leads |
| CRM-22 | Быстрое создание лида «+» | MVP | NOT_DONE | Нет плавающей кнопки |
| CRM-23 | Отчёт «Детализация оттока» | MVP | DONE | /api/reports/churn-details |
| CRM-24 | Отчёт «Непродлённые абонементы» | MVP | DONE | /api/reports/not-renewed |
| CRM-25 | Отчёт «Средний чек» | MVP | DONE | /api/reports/avg-check |
| CRM-26 | Отчёт «Средняя стоимость абонемента» | MVP | DONE | /api/reports/avg-subscription-cost |
| CRM-27 | Отчёт «Конверсия оттока по педагогам» | MVP | DONE | /api/reports/churn-by-instructors |
| CRM-28 | Отчёт «Отток по месяцам» | MVP | DONE | /api/reports/churn-by-months |
| CRM-29 | Отчёт «Отток по направлениям и филиалам» | MVP | DONE | /api/reports/churn-by-directions |
| CRM-30 | Отчёт «Лиды по дням» | MVP | DONE | /api/reports/leads-by-day |
| CRM-31 | Отчёт «Пробники по дням» | MVP | DONE | /api/reports/trials-by-day |
| CRM-32 | Отчёт «Не пришли на пробники» | MVP | DONE | /api/reports/trial-no-show |
| CRM-33 | Отчёт «Эффективность обзвонов» | MVP | DONE | /api/reports/call-efficiency |
| CRM-34 | Отчёт «Загруженность центра» | MVP | DONE | /api/reports/center-load |
| CRM-35 | Отчёт «Продажи менеджеров по каналам» | MVP | DONE | /api/reports/sales-by-channel |
| CRM-36 | Отчёт «Сводный по абонементам в разрезе педагогов» | MVP | DONE | /api/reports/subscriptions-by-instructor |
| CRM-37 | Отчёт «Сколько денег приносит педагог» | MVP | DONE | /api/reports/instructor-profitability |
| CRM-38 | Отчёт «Детализация пробников» | MVP | DONE | /api/reports/trial-details |

## Модуль Расписание

| ID | Описание | Приоритет | Статус | Комментарий |
|---|---|---|---|---|
| SCH-01 | Иерархия: Филиал → Кабинет → Группа | MVP | DONE | Branch → Room → Group |
| SCH-02 | Группа: название, направление, кабинет, инструктор, лимит, шаблон | MVP | DONE | Group + GroupScheduleTemplate |
| SCH-03 | Помесячная генерация из шаблона | MVP | DONE | /api/groups/[id]/generate |
| SCH-03a | Закрытие/архивирование группы | MVP | PARTIAL | soft delete есть, UI кнопки «архив» нет |
| SCH-04 | Просмотр по кабинетам/инструкторам/направлениям | MVP | PARTIAL | Недельный вид есть, переключатели нет |
| SCH-05 | Цветовая индикация заполняемости | MVP | PARTIAL | Цвета по направлениям, не по заполняемости |
| SCH-06 | Запись ученика в группу | MVP | DONE | /api/groups/[id]/enrollments |
| SCH-07 | Перевод между группами | MVP | NOT_DONE | Нет API перевода |
| SCH-08 | Замена инструктора (разовая/постоянная) | MVP | NOT_DONE | Нет substituteInstructorId |
| SCH-09 | Отмена/удаление занятия | MVP | PARTIAL | Единичная есть, массовая (праздники) нет |
| SCH-10 | Индивидуальные занятия | MVP | DONE | Группа с лимитом 1 |
| SCH-11 | Разовые занятия / отработки | MVP | PARTIAL | Настройки есть, полная реализация нет |
| SCH-12 | Производственный календарь | MVP | DONE | /schedule/calendar |
| SCH-13 | Массовое копирование расписания | v1.1 | NOT_DONE | Нет API |
| SCH-14 | Индивидуальное расписание ученика | v1.1 | NOT_DONE | Нет scheduleDays в GroupEnrollment |
| SCH-15 | Отчёт «Свободные места» | MVP | DONE | /api/reports/capacity |
| SCH-16 | Превышение лимита с предупреждением | MVP | PARTIAL | Лимит есть, UI предупреждение не подтверждено |
| SCH-17 | Печать расписания | v1.1 | NOT_DONE | Нет print-стилей |

## Модуль Посещения

| ID | Описание | Приоритет | Статус | Комментарий |
|---|---|---|---|---|
| ATT-01 | Виды дней: настраиваемый справочник | MVP | DONE | AttendanceType с isCustom |
| ATT-02 | Предустановленные: Явка, Прогул, Перерасчёт, Отработка | MVP | DONE | seed/demo-data |
| ATT-03 | Отметка: «Отметить всех» + ручная | MVP | DONE | attendance-table.tsx |
| ATT-04 | Автосписание с абонемента | MVP | DONE | /api/lessons/[id]/attendance |
| ATT-05 | Автоначисление ЗП инструктору | MVP | DONE | attendance route |
| ATT-06 | Отметка задним числом: дедлайн | MVP | DONE | attendanceDeadline + period-check |
| ATT-07 | Мягкое закрытие периода | MVP | DONE | Period модель |
| ATT-08 | Переоткрытие периода (владелец) | MVP | DONE | periodsReopened |
| ATT-09 | Отчёт «Неотмеченные дети» | MVP | PARTIAL | Данные есть, отдельного отчёта нет |
| ATT-10 | Отчёт «Потенциальный отток» (3+ прогула) | MVP | NOT_DONE | Нет API |
| ATT-11 | Отчёт «По посещениям» | MVP | DONE | /api/reports/visits |
| ATT-12 | Отчёт «Отсутствие учеников / потери выручки» | MVP | DONE | /api/reports/absence-losses |
| ATT-13 | Тема занятия и домашнее задание | MVP | DONE | topic, homework в Lesson |
| ATT-14 | Lesson card | MVP | DONE | /schedule/lessons/[id] |

## Модуль Абонементы

| ID | Описание | Приоритет | Статус | Комментарий |
|---|---|---|---|---|
| SUB-01 | Тип «Календарный» | MVP | DONE | SubscriptionType=calendar |
| SUB-02 | Каждый месяц — новый абонемент | MVP | DONE | periodYear, periodMonth |
| SUB-03 | Баланс абонемента | MVP | DONE | balance, chargedAmount |
| SUB-04 | Начало в середине месяца | MVP | DONE | startDate + расчёт |
| SUB-05 | Индивидуальная стоимость занятия | MVP | DONE | lessonPrice |
| SUB-06 | Скидки: постоянные, разовые, связанные | MVP | DONE | Discount + DiscountTemplate |
| SUB-07 | Связанная скидка: пересчёт при отчислении | MVP | PARTIAL | linked тип есть, автопересчёт не подтверждён |
| SUB-08 | Отчисление: причина из справочника | MVP | DONE | withdrawalReasonId |
| SUB-09 | Нет приостановки | MVP | DONE | — |
| SUB-10 | Баланс клиента (остатки) | MVP | DONE | clientBalance + ClientBalanceTransaction |
| SUB-11 | Возврат: только полный остаток | MVP | PARTIAL | PaymentType=return есть, UI механика не полная |
| SUB-12 | Перенос баланса | MVP | PARTIAL | clientBalance есть, автопредложение не подтверждено |
| SUB-13 | Тип «Фикс» | v1.1 | NOT_DONE | Запланировано v1.1 |
| SUB-14 | Тип «Пакетный» | v2 | NOT_DONE | Запланировано v2 |
| SUB-15 | Разовая услуга | v2 | NOT_DONE | Запланировано v2 |

## Модуль Финансы

| ID | Описание | Приоритет | Статус | Комментарий |
|---|---|---|---|---|
| FIN-01 | Приём оплат: 5 способов | MVP | DONE | cash/card/transfer/online/sbp |
| FIN-02 | Внесение расходов | MVP | DONE | /finance/expenses |
| FIN-03 | Привязка расхода к филиал/направление | MVP | DONE | ExpenseBranch, directionId |
| FIN-04 | Статьи расхода: 14 штук | MVP | DONE | ExpenseCategory |
| FIN-05 | Повторяющиеся расходы | MVP | DONE | isRecurring; /api/expenses/copy-month |
| FIN-06 | Отчёт «Должники» | MVP | DONE | /finance/debtors |
| FIN-07 | Отчёт «Оплаты» | MVP | DONE | /api/reports/payments-report |
| FIN-08 | Отчёт «ДДС» | MVP | DONE | /finance/dds |
| FIN-09 | Отчёт «Остаток денег» | MVP | DONE | /api/reports/cash-balance |
| FIN-10 | Отчёт «Ожидаемые поступления» | MVP | DONE | /api/reports/expected-income |
| FIN-11 | Отчёт «Выручка» | MVP | DONE | /reports/finance/revenue |
| FIN-12 | Отчёт «Прогноз прибыли» | MVP | DONE | /api/reports/profit-forecast |
| FIN-13 | Плановые расходы | MVP | DONE | PlannedExpense; /finance/planned-expenses |
| FIN-14 | P&L (формат A) | MVP | DONE | /reports/finance/pnl |
| FIN-15 | P&L по направлениям/филиалам (формат B) | MVP | PARTIAL | P&L есть, формат B как отдельный вид не подтверждён |
| FIN-15a | P&L на уровне группы (формат C) | MVP | DONE | /api/reports/pnl-group |
| FIN-16 | Автораспределение расходов пропорционально выручке | MVP | PARTIAL | Логика в pnl, полная реализация не подтверждена |
| FIN-17 | Перемещение между счетами | MVP | DONE | AccountOperation; /api/account-operations |
| FIN-18 | Возврат средств клиенту | MVP | PARTIAL | Тип return есть, полный flow не завершён |
| FIN-19 | Амортизация расхода | MVP | DONE | amortizationMonths |
| FIN-20 | Поступления по дням | MVP | DONE | /api/reports/daily-income |
| FIN-21 | Онлайн-оплата: ЮKassa + Робокасса | MVP | PARTIAL | Интеграция есть, webhook/idempotency под вопросом |
| FIN-22 | Произвольное количество счетов | MVP | DONE | FinancialAccount |
| FIN-23 | Отчёт «Расчёты с учениками» | MVP | DONE | /api/reports/student-settlements |
| FIN-24 | Отчёт «Календарь постоянных платежей» | MVP | DONE | /api/reports/recurring-payments |
| FIN-25 | Отчёт «Связанные скидки» | MVP | DONE | /api/reports/linked-discounts |
| FIN-26 | Drill-down во всех финансовых отчётах | MVP | NOT_DONE | Нет реализации |
| FIN-27 | Экспорт в Excel/PDF | MVP | NOT_DONE | Нет экспорта |
| FIN-28 | Отчёт «Остатки оплаченных занятий» | MVP | DONE | /api/reports/remaining-lessons |
| FIN-29 | Отчёт «Доход от новых / упущенный доход» | MVP | DONE | /api/reports/new-client-income |
| FIN-30 | Отчёт «% распределения финреза» | MVP | DONE | /api/reports/financial-distribution |
| FIN-31 | Отчёт «Контроль корректировок занятий» | MVP | DONE | /api/reports/lesson-adjustments-audit |
| FIN-32 | Отчёт «Контроль скидок» | MVP | DONE | /api/reports/discount-audit |
| FIN-33 | Справка «?» на каждой странице | MVP | NOT_DONE | Нет компонента PageHelp |

## Модуль Зарплата

| ID | Описание | Приоритет | Статус | Комментарий |
|---|---|---|---|---|
| SAL-01 | Ставка «за ученика» | MVP | DONE | SalaryRate |
| SAL-02 | Ставка «за занятие» (фикс) | MVP | DONE | SalaryRate |
| SAL-03 | Ставка «фикс за выход + за ученика» | MVP | DONE | SalaryRate комбинированный |
| SAL-04 | Привязка ставки к сотрудник+филиал+направление+группа | MVP | DONE | SalaryRate связи |
| SAL-05 | Автоначисление при отметке | MVP | DONE | attendance route |
| SAL-06 | Начислено / Выплачено / Осталось | MVP | DONE | /salary |
| SAL-07 | Кнопка «Выплатить» | MVP | DONE | SalaryPayment |
| SAL-08 | Премии и штрафы | MVP | DONE | SalaryAdjustment |
| SAL-09 | Детализация начислений до занятия | MVP | DONE | Attendance → salaryAmount |
| SAL-10 | Оплата пробных: только за платные | MVP | PARTIAL | TrialLesson есть, ручное включение не подтверждено |
| SAL-11 | Замена инструктора: ЗП по ставке заменяющего | MVP | NOT_DONE | Нет механизма замены |
| SAL-11a | Карточка сотрудника: документы (PDF) | v1.1 | PARTIAL | Карточка есть, загрузка PDF нет |
| SAL-11b | Корректировки прошлых периодов | MVP | PARTIAL | Закрытие периода есть, отображение корректировок не подтверждено |
| SAL-12 | Мотивация админа: бонусная система | MVP | DONE | AdminBonusSettings |
| SAL-15 | Отчёт «Прогноз сдельной оплаты» | MVP | DONE | /api/reports/salary-forecast |
| SAL-16 | Отчёт «Часы педагогов по дням» | MVP | DONE | /api/reports/instructor-hours |
| SAL-17 | Отчёт «Средняя ЗП педагогов» | MVP | DONE | /api/reports/avg-salary |
| SAL-18 | Отчёт «Расчёты с педагогами» | MVP | DONE | /api/reports/salary-instructors |

## Модуль Дашборд + задачи

| ID | Описание | Приоритет | Статус | Комментарий |
|---|---|---|---|---|
| DSH-01 | Настраиваемый главный экран | MVP | PARTIAL | Виджеты есть, настройка (drag/toggle) нет |
| DSH-02 | Задачи: ручные | MVP | DONE | /tasks |
| DSH-03 | Задачи: автоматические | MVP | DONE | /api/tasks/generate |
| DSH-04 | Приоритет по дате | MVP | DONE | Сортировка по dueDate |
| DSH-05 | Фильтрация задач | MVP | DONE | /tasks с фильтрами |
| DSH-06 | Уведомления: колокольчик | MVP | DONE | notification-bell.tsx |
| DSH-07 | Задачи привязаны к системным датам | MVP | DONE | /api/tasks/generate |

## Модуль Обзвон

| ID | Описание | Приоритет | Статус | Комментарий |
|---|---|---|---|---|
| CALL-01 | Фильтр базы → список обзвона | MVP | DONE | create-campaign-dialog.tsx |
| CALL-02 | Карточка обзвона | MVP | DONE | /crm/calls/[id] |
| CALL-03 | Обзвон внутри CRM | MVP | DONE | CallCampaignItem |
| CALL-04 | Закрытый обзвон → архив | MVP | PARTIAL | Статус есть, связь с историей коммуникации нет |
| CALL-05 | Отчёт «Эффективность обзвонов» | MVP | DONE | /api/reports/call-efficiency |

## Модуль Склад

| ID | Описание | Приоритет | Статус | Комментарий |
|---|---|---|---|---|
| INV-01 | Закупка товаров на склад | MVP | NOT_DONE | Заглушка «в разработке» |
| INV-02 | Перемещение склад → кабинет | MVP | NOT_DONE | Нет моделей |
| INV-03 | Баланс кабинета | MVP | NOT_DONE | — |
| INV-04 | Амортизация при закупке | MVP | NOT_DONE | — |
| INV-06 | Отчёт «Остатки» по филиалам | MVP | NOT_DONE | — |

## Администрирование

| ID | Описание | Приоритет | Статус | Комментарий |
|---|---|---|---|---|
| ADM-01 | Мультитенантность: tenant_id + RLS | MVP | DONE | 104 поля tenantId; RLS миграция |
| ADM-02 | Мультифилиальность | MVP | DONE | Branch + переключатель |
| ADM-03 | 5 ролей: настраиваемые | MVP | PARTIAL | Роли есть, UI настройки прав нет |
| ADM-04 | Ограничение доступа по филиалам | MVP | DONE | EmployeeBranch |
| ADM-05 | Wizard онбординга | MVP | NOT_DONE | Нет компонентов |
| ADM-06 | Справочник «Виды дней» | MVP | DONE | AttendanceType |
| ADM-07 | Справочник «Статьи расхода» | MVP | DONE | ExpenseCategory |
| ADM-08 | Справочник «Каналы привлечения» | MVP | PARTIAL | channelId есть, модель справочника нет |
| ADM-09 | Справочник «Причины отчисления» | MVP | PARTIAL | withdrawalReasonId есть, модель нет |
| ADM-09a | Справочник «Причины пропусков» | MVP | NOT_DONE | Нет модели |
| ADM-10 | Производственный календарь | MVP | DONE | /schedule/calendar |
| ADM-11 | Импорт клиентов (миграция) | MVP | NOT_DONE | Нет скрипта |
| ADM-12 | Аудит действий | MVP | DONE | AuditLog; /api/audit |
| ADM-13 | Настройки организации | MVP | DONE | /settings |
| ADM-14 | Кастомные названия ролей | v1.1 | PARTIAL | roleDisplayNames в schema, UI нет |
| ADM-15 | Настройки филиала: часы, рабочие дни | MVP | DONE | workingHours в Branch |

## Модуль Кандидаты

| ID | Описание | Приоритет | Статус | Комментарий |
|---|---|---|---|---|
| CAND-01 | Список кандидатов в модуле сотрудников | v1.1 | NOT_DONE | Нет типа кандидат |
| CAND-02 | Карточка кандидата | v1.1 | NOT_DONE | — |
| CAND-03 | Статусы кандидата | v1.1 | NOT_DONE | — |
| CAND-04 | История встреч с комментариями | v1.1 | NOT_DONE | — |

## Бэк-офис SaaS

| ID | Описание | Приоритет | Статус | Комментарий |
|---|---|---|---|---|
| ADMIN-01 | Управление партнёрами | MVP | DONE | /admin/partners |
| ADMIN-02 | Тарифы | MVP | DONE | BillingPlan; /admin/plans |
| ADMIN-03 | Подписки и биллинг | MVP | DONE | BillingSubscription |
| ADMIN-04 | Счета | MVP | DONE | BillingInvoice; /admin/invoices |
| ADMIN-05 | Блокировка/разблокировка | MVP | DONE | billingStatus |

## Личные кабинеты

| ID | Описание | Приоритет | Статус | Комментарий |
|---|---|---|---|---|
| PORT-01 | ЛК партнёра: подписка, счета | MVP | DONE | /billing |
| PORT-02 | ЛК клиента: расписание, баланс, оплата | MVP | DONE | /portal |

## Сквозные требования

| Требование | Приоритет | Статус | Комментарий |
|---|---|---|---|
| PWA | MVP | PARTIAL | manifest есть, next-pwa не настроен |
| Хлебные крошки на всех страницах | MVP | PARTIAL | breadcrumb.tsx есть, не на всех страницах |
| Глобальный переключатель филиала | MVP | PARTIAL | Фильтр есть, глобального dropdown нет |
| Soft delete (deleted_at) | MVP | DONE | Во всех ключевых моделях |
| Плашки биллинга | MVP | DONE | Грейс-период, блокировка |

---

## Критичные пробелы для MVP (требуют реализации до 1 июня 2026)

### Блокеры пилота (нужны для тестирования с Анной)

1. **SCH-07** Перевод ученика между группами
2. **SCH-08** Замена инструктора (разовая/постоянная)
3. **FIN-33** Справка «?» на каждой странице (PageHelp)
4. **ADM-08** Справочник «Каналы привлечения» — отдельная модель
5. **ADM-09** Справочник «Причины отчисления» — отдельная модель
6. **CRM-07** Каналы привлечения — полный CRUD
7. **CRM-10** Защита от дублей — предупреждение при создании

### Важные для MVP (до запуска)

8. **CRM-02** История коммуникации (лента)
9. **FIN-27** Экспорт отчётов Excel/PDF
10. **FIN-26** Drill-down в финансовых отчётах
11. **ADM-05** Wizard онбординга
12. **ADM-11** Импорт клиентов
13. **INV-01..06** Модуль Склад (5 пунктов)
14. **ATT-10** Отчёт «Потенциальный отток» (3+ прогула)
15. **CRM-17** Отчёт «Допродажи и возвраты»
16. **CRM-22** Быстрое создание лида «+»
17. **ADM-09a** Справочник «Причины пропусков»

### Можно перенести на v1.1

18. **CRM-12** Объединение дубликатов
19. **SCH-13** Массовое копирование расписания
20. **SCH-14** Индивидуальное расписание ученика
21. **SCH-17** Печать расписания
22. **CAND-01..04** Модуль Кандидаты (4 пункта)
23. **SUB-13** Тип «Фикс»
24. **ADM-14** Кастомные названия ролей
25. **SAL-11a** Загрузка документов сотрудника (PDF)

---

## История аудитов

| Дата | Версия | Результат |
|---|---|---|
| 2026-03-16 | v1 (audit.md) | 65/68 пунктов документации рассмотрено |
| 2026-04-08 | v2 (audit-v2.md) | 172 требования PRD: 118 DONE, 27 PARTIAL, 27 NOT_DONE |
