import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHelp } from "@/components/page-help"

type ChangeType = "added" | "fixed" | "removed" | "changed"

interface Change {
  type: ChangeType
  text: string
}

interface Release {
  version: string
  date: string
  title: string
  changes: Change[]
}

const releases: Release[] = [
  {
    version: "1.5.1-alpha",
    date: "10.04.2026",
    title: "Супертест: полный бизнес-цикл 3.5 месяца + UI-верификация",
    changes: [
      { type: "added", text: "Супертест: 3 филиала, 50 клиентов, 150 абонементов, 1126 занятий, 700 посещений, 146 оплат, 72 расхода, 60 зарплат, 3 закрытых периода" },
      { type: "added", text: "Верификация UI: 46 проверок — дашборд, P&L, ДДС, зарплата, воронка, отчёты, клиенты, расписание, карточки" },
      { type: "added", text: "Троттлинг API: автоматическая пауза при 80 req/min + retry на 429 (готовность к 500+ клиентам)" },
      { type: "changed", text: "Мега-тест: создание сущностей через API вместо хрупких UI-диалогов" },
      { type: "fixed", text: "12+ исправлений селекторов Playwright (Base UI, Lucide, strict mode)" },
      { type: "fixed", text: "Завершение онбординга перед дашбордом (виджеты не отображались)" },
    ],
  },
  {
    version: "1.5.0-alpha",
    date: "09.04.2026",
    title: "Закрытие MVP: 42 фичи, безопасность, интеграции, PWA",
    changes: [
      { type: "added", text: "CRM-02: история коммуникаций (лента, вебхуки, интеграции с мессенджерами)" },
      { type: "added", text: "CRM-10: предупреждение о дублях при создании клиента/лида (debounce по телефону)" },
      { type: "added", text: "CRM-12: объединение дубликатов клиентов (транзакционный merge)" },
      { type: "added", text: "CRM-17: отчёт допродаж (одно направление / скоро истекает / снизили активность)" },
      { type: "added", text: "CRM-18: сортировка лидов по дате контакта с подсветкой просроченных" },
      { type: "added", text: "CRM-22: быстрое создание лида (кнопка «+» на дашборде и странице лидов)" },
      { type: "added", text: "SCH-03a: архивирование групп (soft delete + UI toggle «Показать архивные»)" },
      { type: "added", text: "SCH-04: фильтры расписания по кабинетам, педагогам, направлениям (бейджи + сброс)" },
      { type: "added", text: "SCH-05: цветовая индикация заполняемости групп (зелёный/жёлтый/красный + легенда)" },
      { type: "added", text: "SCH-07: перевод ученика между группами" },
      { type: "added", text: "SCH-08: замена инструктора на занятии (разовая / постоянная)" },
      { type: "added", text: "SCH-09: массовая отмена занятий на день (праздники, каникулы)" },
      { type: "added", text: "SCH-11: разовые занятия и отработки (поиск ученика, бейдж «отработка», списание с абонемента)" },
      { type: "added", text: "SCH-13: массовое копирование расписания на следующий месяц" },
      { type: "added", text: "SCH-14: индивидуальное расписание ученика (таб в карточке клиента)" },
      { type: "added", text: "SCH-16: предупреждение при превышении лимита группы (confirm dialog)" },
      { type: "added", text: "SCH-17: печать расписания (print-friendly CSS)" },
      { type: "added", text: "ATT-09: отчёт «Неотмеченные дети» (занятия без отметок, Excel экспорт)" },
      { type: "added", text: "ATT-10: отчёт «Потенциальный отток» (3+ пропусков подряд)" },
      { type: "added", text: "SUB-07: автопересчёт связанной скидки при отчислении" },
      { type: "added", text: "SUB-11: полный flow возврата абонемента (preview + деактивация)" },
      { type: "added", text: "SUB-12: перенос баланса между абонементами (два Payment для аудита)" },
      { type: "added", text: "FIN-15: P&L по направлениям (распределение постоянных расходов пропорционально)" },
      { type: "added", text: "FIN-16: утилита автораспределения постоянных расходов по выручке" },
      { type: "added", text: "FIN-18: полный flow возврата средств клиенту (двухшаговый диалог, красная стилизация)" },
      { type: "added", text: "FIN-21: ЮKassa webhook (payment.succeeded, refund.succeeded, IP whitelist, идемпотентность)" },
      { type: "added", text: "FIN-26: drill-down в P&L, выручке, ДДС (выдвижная панель с деталями)" },
      { type: "added", text: "FIN-27: экспорт отчётов в Excel (6 отчётов, библиотека xlsx)" },
      { type: "added", text: "SAL-10: настройка оплаты пробных занятий педагогу (только за платные)" },
      { type: "added", text: "SAL-11: ЗП по ставке заменяющего инструктора (во всех отчётах + бейдж «замена»)" },
      { type: "added", text: "SAL-11b: корректировки закрытых периодов в зарплатной ведомости" },
      { type: "added", text: "ADM-03: UI настройки прав ролей (19 разрешений, 7 групп, матрица чекбоксов)" },
      { type: "added", text: "ADM-05: wizard онбординга для новых партнёров (6 шагов)" },
      { type: "added", text: "ADM-08: справочник каналов привлечения (13 предустановленных + кастомные)" },
      { type: "added", text: "ADM-09a: справочник причин пропусков (7 предустановленных)" },
      { type: "added", text: "ADM-11: импорт клиентов из CSV/Excel с маппингом колонок" },
      { type: "added", text: "ADM-14: кастомные названия ролей (UI в настройках)" },
      { type: "added", text: "DSH-01: настраиваемый дашборд (toggle виджетов, порядок, localStorage)" },
      { type: "added", text: "PWA: manifest.json, service worker, иконки, регистрация" },
      { type: "added", text: "Хлебные крошки на всех 46 страницах (автоматический компонент в layout)" },
      { type: "added", text: "Справка «?» (PageHelp) на всех страницах с описанием интерфейса" },
      { type: "added", text: "Playwright: 338 тестов в 26 файлах" },
      { type: "changed", text: "Аудит PRD v2: 172 требования проверены, 145 DONE, 22 PARTIAL, 5 NOT_DONE" },
    ],
  },
  {
    version: "1.4.1-alpha",
    date: "08.04.2026",
    title: "Безопасность, интеграции, аудит мультитенантности",
    changes: [
      { type: "added", text: "Сброс пароля: forgot/reset password flow через email" },
      { type: "added", text: "Т-Банк API: интеграция оплаты (тестовый режим, webhook, QR-код)" },
      { type: "added", text: "AI-ассистент: чат-виджет с аналитикой на базе Claude Haiku" },
      { type: "added", text: "Страница оферты (/offer)" },
      { type: "added", text: "Выбор периода оплаты в ЛК партнёра (1/3/6/12 мес)" },
      { type: "added", text: "PostgreSQL RLS: Row Level Security для изоляции тенантов" },
      { type: "added", text: "Rate limiting: защита API (100 req/min per tenant, admin auth brute-force)" },
      { type: "added", text: "AuditLog: расширенная модель + интеграция в финансовые эндпоинты" },
      { type: "added", text: "Period closure: блокировка мутаций в закрытых периодах" },
      { type: "added", text: "Lead→Client: автоконверсия при первом платном посещении" },
      { type: "added", text: "MonthPicker: переключатель месяцев на 13 страницах" },
      { type: "added", text: "API-документация (docs/api.md)" },
      { type: "added", text: "10+ дополнительных отчётов из reports-logic.md" },
      { type: "added", text: "Новые таблицы: ProductionCalendar, DiscountTemplate, PlannedExpense, Notification" },
      { type: "fixed", text: "RBAC: проверка ролей на payments и salary-payments" },
      { type: "fixed", text: "Мультитенантность: tenantId во всех API-эндпоинтах" },
      { type: "fixed", text: "P&L: фильтр переменных расходов по category.isVariable" },
      { type: "fixed", text: "Attendance: $transaction() + проверка статуса подписки" },
      { type: "fixed", text: "Bulk attendance: batch preload вместо N+1 запросов" },
      { type: "fixed", text: "Воронка: фильтрация по месяцу + блок перетекающих" },
      { type: "fixed", text: "Seed/reset-db заблокированы в production (NODE_ENV check)" },
    ],
  },
  {
    version: "1.4.0-alpha",
    date: "01.04.2026",
    title: "Модуль 10: Биллинг + ЛК — SaaS-слой, 10/10 модулей MVP",
    changes: [
      { type: "added", text: "Бэк-офис (/admin): JWT-авторизация, 4 роли (superadmin, support, development, billing)" },
      { type: "added", text: "Бэк-офис: управление партнёрами (список, карточка, CRUD, блокировка/разблокировка)" },
      { type: "added", text: "Бэк-офис: тарифные планы (CRUD), подписки, счета с автономером INV-YYYYMM-XXX" },
      { type: "added", text: "ЛК партнёра (/billing): подписка, счета, история оплат (owner/manager)" },
      { type: "added", text: "ЛК клиента (/portal): токенный вход, согласие ПДн, расписание, баланс, абонементы, оплаты" },
      { type: "added", text: "Плашки биллинга в CRM: грейс-период (жёлтая), блокировка (красная), предупреждение за 5 дней (синяя)" },
      { type: "added", text: "Пункт «Подписка» в сайдбаре (только owner/manager)" },
      { type: "added", text: "Prisma: AdminUser, BillingPlan, BillingSubscription, BillingInvoice, ClientPortalToken" },
      { type: "added", text: "Playwright: 24 новых теста (10 бэк-офис + 7 ЛК партнёра + 7 ЛК клиента), всего 124 E2E" },
    ],
  },
  {
    version: "1.3.0-alpha",
    date: "31.03.2026",
    title: "Закрытие пробелов: обзвон, автозадачи, 10 отчётов, 100 тестов",
    changes: [
      { type: "added", text: "Обзвон: страница кампании с прогресс-баром, контактами, кнопкой «Позвонить» и результатом" },
      { type: "added", text: "Обзвон: фильтры при создании (статус клиента, сегмент), кликабельные кампании" },
      { type: "added", text: "Автозадачи: генерация по 5 триггерам (контакт, обещание, ДР, неотмеченные, ожидание оплаты)" },
      { type: "added", text: "Отчёт: средний чек (по способам оплаты)" },
      { type: "added", text: "Отчёт: непродлённые абонементы (потери, коэффициент продления)" },
      { type: "added", text: "Отчёт: выручка по направлениям" },
      { type: "added", text: "Отчёт: посещения (явки, прогулы, по группам)" },
      { type: "added", text: "Отчёт: сводный по педагогам (занятия, ученики, ЗП)" },
      { type: "added", text: "Воронка продаж: табличный вид лидов с фильтрацией по статусам" },
      { type: "added", text: "Каталог отчётов: все 10 помечены как готовые" },
      { type: "changed", text: "CRM: /crm/funnel → /crm/leads (Лиды), раздельные потоки Лиды/Клиенты по PRD" },
      { type: "changed", text: "Клиенты: показывают только active_client, вкладки Активные/Допродажа/Выбывшие/Все" },
      { type: "added", text: "Playwright: 10 новых тестов, всего 100 E2E тестов" },
    ],
  },
  {
    version: "1.2.0-alpha",
    date: "31.03.2026",
    title: "Модуль 9: Дашборд — реальные данные, 8 виджетов, 90 тестов",
    changes: [
      { type: "added", text: "Дашборд: реальные данные вместо демо (абонементы, выручка, расходы, должники)" },
      { type: "added", text: "Виджет «Задачи на сегодня»: задачи из БД с привязкой к клиентам" },
      { type: "added", text: "Виджет «Неотмеченные занятия»: прошедшие занятия без отметки" },
      { type: "added", text: "Виджет «Воронка продаж»: мини-воронка по статусам из БД" },
      { type: "added", text: "Виджет «Заполняемость групп»: топ-5 с прогресс-барами" },
      { type: "added", text: "Кликабельные карточки и виджеты — переход в соответствующий раздел" },
      { type: "added", text: "Playwright: 4 новых теста дашборда, всего 90 E2E тестов" },
      { type: "removed", text: "Демо-данные на дашборде заменены реальными запросами" },
    ],
  },
  {
    version: "1.1.0-alpha",
    date: "31.03.2026",
    title: "Модуль 8: Задачи + Обзвон — CRUD задач, кампании обзвона, 87 тестов",
    changes: [
      { type: "added", text: "Задачи: список (на сегодня/просрочено/выполнено), создание, чекбокс выполнения" },
      { type: "added", text: "Привязка задачи к клиенту, исполнитель, дата" },
      { type: "added", text: "Обзвон: кампании (список, создание), автодобавление клиентов, прогресс" },
      { type: "added", text: "API: tasks CRUD, call-campaigns CRUD" },
      { type: "added", text: "Prisma: Task, CallCampaign, CallCampaignItem + 5 enums" },
      { type: "added", text: "Playwright: 7 новых тестов, всего 87 E2E тестов" },
    ],
  },
  {
    version: "1.0.0-alpha",
    date: "31.03.2026",
    title: "Модуль 7: Отчёты — каталог + 4 аналитических отчёта, 80 тестов",
    changes: [
      { type: "added", text: "Каталог отчётов: 4 группы (CRM, отток, расписание, финансы) с бейджами готовности" },
      { type: "added", text: "Воронка продаж: распределение по статусам, конверсии между этапами, метрики за месяц" },
      { type: "added", text: "Детализация оттока: выбывшие по направлениям, филиалам, инструкторам" },
      { type: "added", text: "Финрез P&L: выручка − переменные − постоянные = чистая прибыль + рентабельность" },
      { type: "added", text: "Свободные места: загрузка групп (занято / макс / свободно / %)" },
      { type: "added", text: "Playwright: 6 новых тестов отчётов, всего 80 E2E тестов" },
    ],
  },
  {
    version: "0.9.0",
    date: "31.03.2026",
    title: "Модуль 6: ДДС, Зарплата, Должники — финансовый модуль завершён",
    changes: [
      { type: "added", text: "ДДС: отчёт движения денежных средств (приход/расход по категориям, остатки по счетам, операции)" },
      { type: "added", text: "Зарплата: ведомость (начислено/премии/штрафы/выплачено/осталось), выплата ЗП из счёта" },
      { type: "added", text: "Должники: список клиентов с отрицательным балансом, переход в карточку, просроченные даты" },
      { type: "added", text: "API: salary-payments, salary-adjustments (GET/POST)" },
      { type: "added", text: "Prisma: SalaryPayment, SalaryAdjustment + миграция" },
      { type: "added", text: "Сайдбар: ссылка «Должники» в блоке Финансы" },
      { type: "added", text: "Playwright: 9 новых тестов, всего 74 E2E теста" },
    ],
  },
  {
    version: "0.8.0",
    date: "31.03.2026",
    title: "Модуль 6A: Расходы, Prisma Migrations, 65 тестов",
    changes: [
      { type: "added", text: "Расходы: полный CRUD (создание, редактирование, удаление), 14 системных категорий" },
      { type: "added", text: "Summary-карточки: расходы за месяц, постоянные, переменные, повторяющиеся" },
      { type: "added", text: "Итого по статьям расходов" },
      { type: "added", text: "Копирование повторяющихся расходов с прошлого месяца" },
      { type: "added", text: "Амортизация: распределение расхода на N месяцев" },
      { type: "added", text: "Привязка расхода к филиалам (один/несколько/все)" },
      { type: "added", text: "Операции между счетами: выемки, инкассации, переводы (API)" },
      { type: "added", text: "Prisma Migrations: переход с db push на правильные миграции" },
      { type: "added", text: "Локальная PostgreSQL для разработки" },
      { type: "added", text: "Playwright: 10 новых тестов расходов, всего 65 E2E тестов" },
      { type: "fixed", text: "UTC timezone баг: расходы/оплаты последнего дня месяца не отображались" },
      { type: "changed", text: "CI/CD: baseline миграция для dev-сервера, prisma migrate deploy" },
    ],
  },
  {
    version: "0.7.0",
    date: "31.03.2026",
    title: "Отметка посещений, lesson card, roadmap",
    changes: [
      { type: "added", text: "Lesson card: заголовок, тема/ДЗ (автосохранение), таблица учеников с типами дней" },
      { type: "added", text: "Отметка посещений: Явка/Прогул/Перерасчёт/Отработка с автосписанием с абонемента" },
      { type: "added", text: "«Отметить всех — Явка»: массовая отметка за одно нажатие" },
      { type: "added", text: "Расчёт ЗП инструктора: автоматически по ставке (за ученика/за занятие/фикс)" },
      { type: "added", text: "Клик на занятие в расписании → lesson card" },
      { type: "added", text: "Roadmap: визуальный план модулей с прогрессом" },
      { type: "added", text: "Changelog и Roadmap в сайдбаре" },
    ],
  },
  {
    version: "0.6.0",
    date: "31.03.2026",
    title: "Абонементы, оплаты, полный CRUD, 55 тестов",
    changes: [
      { type: "added", text: "Абонементы: создание из карточки клиента, авторасчёт суммы, статусы (ожидание/активен/закрыт/отчислен)" },
      { type: "added", text: "Оплаты: создание с привязкой к абонементу, автоактивация при первой оплате, сводка по способам" },
      { type: "added", text: "Касса: реальные счета (касса/р/с/эквайринг/онлайн), балансы, операции за день" },
      { type: "added", text: "Редактирование: счета (карандаш), клиенты (карандаш в sidebar), абонементы (цена/статус)" },
      { type: "added", text: "Playwright: 55 тестов, полный E2E бизнес-сценарий из 16 шагов" },
      { type: "changed", text: "Все кнопки создания/редактирования скрыты для ролей без прав" },
      { type: "fixed", text: "API валидация: кнопка «Сохранить» вместо «Создать» в диалоге оплаты" },
    ],
  },
  {
    version: "0.5.0",
    date: "30.03.2026",
    title: "Группы, расписание, редактирование",
    changes: [
      { type: "added", text: "Группы: создание, редактирование, шаблоны расписания (дни/время/длительность)" },
      { type: "added", text: "Расписание: недельный вид по кабинетам с реальными данными из БД" },
      { type: "added", text: "Генерация расписания: из шаблона на выбранный месяц" },
      { type: "added", text: "Зачисление учеников: привязка клиента/подопечного к группе" },
      { type: "added", text: "Карточка группы: 3 вкладки (расписание, состав, настройки)" },
      { type: "added", text: "Направления: полный CRUD (создание + редактирование)" },
      { type: "added", text: "Навигация: кнопка «Группы» из расписания" },
      { type: "changed", text: "Редактирование группы перенесено из таблицы в карточку (вкладка «Настройки»)" },
      { type: "fixed", text: "Select показывал UUID вместо названий (base-ui SelectValue)" },
      { type: "fixed", text: "Длительность нового дня берётся из направления, а не 60 мин" },
    ],
  },
  {
    version: "0.4.0",
    date: "30.03.2026",
    title: "Клиенты и подопечные",
    changes: [
      { type: "added", text: "Список клиентов: фильтры (все/активные/лиды/выбывшие), поиск, бейджи сегментов и статусов" },
      { type: "added", text: "Создание клиента: ФИО, контакты, филиал, подопечные — всё из одной формы" },
      { type: "added", text: "Карточка клиента: баланс, статусы, sidebar с LTV, филиалом, датами" },
      { type: "added", text: "Подопечные: список с возрастом, добавление inline-формой" },
      { type: "added", text: "API: полный CRUD клиентов, подопечных, с валидацией и правами" },
      { type: "added", text: "Бизнес-правило: лид→клиент необратимый, валидация телефон/соцсеть" },
    ],
  },
  {
    version: "0.3.0",
    date: "30.03.2026",
    title: "Организация, сотрудники, настройки",
    changes: [
      { type: "added", text: "Настройки организации: 4 вкладки (организация, филиалы, направления, справочники) с реальными данными из БД" },
      { type: "added", text: "Сотрудники: таблица с ролями, филиалами, датой рождения, статусом" },
      { type: "added", text: "Создание сотрудника: диалог с валидацией, русскими ошибками" },
      { type: "added", text: "Редактирование сотрудника: ФИО, контакты, дата рождения, роль, филиалы, смена пароля" },
      { type: "added", text: "API: CRUD сотрудников, организации, направлений с проверкой прав" },
      { type: "added", text: "Сайдбар: реальные данные из сессии (имя, роль, организация), кнопка выхода" },
      { type: "added", text: "Prisma: Direction, EmployeeBranch, SalaryRate, AuditLog" },
      { type: "changed", text: "Кнопки создания/редактирования скрыты для ролей без прав" },
    ],
  },
  {
    version: "0.2.0",
    date: "25.03.2026",
    title: "Авторизация и мультитенант",
    changes: [
      { type: "added", text: "Авторизация: логин/пароль через NextAuth + JWT-сессии" },
      { type: "added", text: "5 ролей: владелец, управляющий, администратор, инструктор, только чтение" },
      { type: "added", text: "Страница логина с формой входа" },
      { type: "added", text: "Middleware: все страницы защищены, редирект на /login" },
      { type: "added", text: "PostgreSQL: схема БД (организация, филиалы, кабинеты, сотрудники)" },
      { type: "added", text: "Демо-данные: 5 аккаунтов для тестирования каждой роли" },
    ],
  },
  {
    version: "0.1.0",
    date: "25.03.2026",
    title: "Прототип интерфейса",
    changes: [
      { type: "added", text: "Layout: сайдбар с навигацией, выбор филиала, профиль пользователя" },
      { type: "added", text: "Дашборд: карточки статистики, задачи, неотмеченные занятия, воронка продаж" },
      { type: "added", text: "Расписание: недельный вид по кабинетам с цветными карточками занятий" },
      { type: "added", text: "Клиенты: список с фильтрами и поиском, карточка клиента с абонементами" },
      { type: "added", text: "Оплаты: сводка по способам оплаты, таблица поступлений" },
      { type: "added", text: "Касса: остатки по счетам, операции за день" },
      { type: "added", text: "Changelog: страница версионирования" },
      { type: "added", text: "Инфраструктура: Docker, CI/CD (GitHub Actions), SSL, dev.umnayacrm.ru" },
    ],
  },
]

const typeConfig: Record<ChangeType, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  added: { label: "Добавлено", variant: "default" },
  fixed: { label: "Исправлено", variant: "secondary" },
  changed: { label: "Изменено", variant: "outline" },
  removed: { label: "Удалено", variant: "destructive" },
}

export default function ChangelogPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Changelog</h1>
          <PageHelp pageKey="changelog" />
        </div>
        <p className="text-sm text-muted-foreground">История изменений Умной CRM</p>
      </div>

      <div className="space-y-6">
        {releases.map((release) => (
          <Card key={release.version}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <CardTitle className="text-lg">v{release.version}</CardTitle>
                <Badge variant="outline">{release.date}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{release.title}</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {release.changes.map((change, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <Badge variant={typeConfig[change.type].variant} className="mt-0.5 shrink-0 text-xs">
                    {typeConfig[change.type].label}
                  </Badge>
                  <span>{change.text}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
