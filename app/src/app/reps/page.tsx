"use client"

import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Filter,
  Calendar,
  CreditCard,
  Wallet,
  Package,
  GraduationCap,
} from "lucide-react"

// ───────────────────────────────────────────────────────────────────────────
// ДАННЫЕ
// ───────────────────────────────────────────────────────────────────────────

type Status = "ok" | "partial" | "missing"

/** Каждый пункт — пара: что нужно и откуда оно берётся в UI/системе */
interface DataItem {
  what: string
  from: string
}

interface Report {
  id: string
  name: string
  data: DataItem[]
  status: Status
  gap?: string
}

interface Module {
  key: string
  title: string
  icon: typeof Filter
  color: string
  reports: Report[]
}

const modules: Module[] = [
  {
    key: "crm",
    title: "CRM и маркетинг",
    icon: Filter,
    color: "text-blue-600",
    reports: [
      {
        id: "CRM-13",
        name: "Воронка продаж",
        data: [
          { what: "Клиент: статус в воронке, дата создания", from: "Drag&drop в /crm/funnel или Select в карточке лида; дата создания — авто" },
          { what: "Пробное занятие: дата, статус (назначен / посетил)", from: "Диалог «Записать на пробное» в карточке лида; статус — отметка на занятии" },
          { what: "Абонемент: дата создания, дата активации", from: "Диалог «Новый абонемент» в карточке клиента; активация — авто при первом списании" },
          { what: "Оплата: дата, флаг первой оплаты", from: "Диалог «Принять оплату» в /finance/payments или карточке клиента; isFirstPayment — авто" },
        ],
        status: "ok",
      },
      {
        id: "CRM-14",
        name: "Конверсия пробных по инструкторам",
        data: [
          { what: "Пробное занятие: педагог, статус, дата посещения", from: "Диалог «Записать на пробное» (выбор педагога); статус и attendedAt — отметка занятия" },
          { what: "Клиент: дата первого платного занятия", from: "Авто при первом посещении со списанием" },
          { what: "Оплата: флаг первой оплаты", from: "Авто (первая входящая оплата клиента)" },
        ],
        status: "ok",
      },
      {
        id: "CRM-15",
        name: "Лиды по каналам и менеджерам",
        data: [
          { what: "Клиент: канал привлечения, ответственный менеджер, дата создания", from: "Поля «Канал» и «Ответственный» в диалоге «Новый клиент» (/crm/leads); дата — авто" },
          { what: "Справочник каналов привлечения", from: "Страница /settings/channels — CRUD каналов" },
          { what: "Абонемент: дата создания", from: "Авто при создании абонемента в карточке клиента" },
          { what: "Пробное занятие: даты назначения / посещения", from: "Диалог «Записать на пробное» (scheduledDate) + отметка занятия (attendedAt)" },
        ],
        status: "ok",
      },
      {
        id: "CRM-16",
        name: "Доходимость (по каналам)",
        data: [
          { what: "Абонемент: дата создания", from: "Авто при создании в карточке клиента" },
          { what: "Пробное занятие: дата назначения / посещения", from: "Диалог «Записать на пробное» + отметка занятия" },
          { what: "Оплата: дата", from: "Диалог «Принять оплату»" },
          { what: "Клиент: канал, дата первого платного занятия", from: "Поле «Канал» в форме лида; firstPaidLessonDate — авто" },
        ],
        status: "ok",
      },
      {
        id: "CRM-17",
        name: "Допродажи и возвраты",
        data: [
          { what: "Клиент: статус (допродажа / возврат / активный)", from: "Авто (вычисляется по активным абонементам и истории клиента)" },
          { what: "Абонемент: ссылка на предыдущий", from: "Авто (previousSubscriptionId при создании следующего абонемента)" },
          { what: "Оплата: тип «возврат»", from: "Диалог «Возврат» в карточке абонемента (вкладка «Абонементы» клиента)" },
        ],
        status: "ok",
      },
      {
        id: "CRM-19",
        name: "Сегментация клиентов",
        data: [
          { what: "Клиент: сегмент (Новый / Стандарт / Постоянный / VIP)", from: "Авто по правилу: 1-3 → новый, 4-12 → стандарт, 13-18 → постоянный, 19+ → VIP" },
          { what: "Клиент: общее количество абонементов", from: "Авто (счётчик totalSubscriptionsCount пересчитывается при создании абонемента)" },
        ],
        status: "ok",
      },
      {
        id: "CRM-23",
        name: "Детализация оттока",
        data: [
          { what: "Абонемент: дата отчисления, причина отчисления", from: "Кнопка «Отчислить» во вкладке «Абонементы» карточки клиента — задаёт withdrawalDate; причина — поле есть, но справочника нет" },
          { what: "Дата последнего платного занятия", from: "Авто (вычисляется из посещений со списанием > 0)" },
          { what: "Связи: педагог, направление, кабинет, филиал", from: "Авто из группы абонемента (/schedule/groups)" },
        ],
        status: "partial",
        gap: "Нет страницы /settings/withdrawal-reasons и модели WithdrawalReason — поле «причина» сохраняется как UUID без таблицы. Нет флагов «исключить из оттока по направлению / по педагогу» при отчислении",
      },
      {
        id: "CRM-24",
        name: "Непродлённые абонементы",
        data: [
          { what: "Посещения со списанием за прошлый и текущий месяц", from: "Отметка явок/прогулов в карточке занятия (attendance-table)" },
          { what: "Абонементы прошлого месяца без продолжения", from: "Авто (расчёт на отчёте)" },
          { what: "Комментарии администратора по непродлённым", from: "Поле комментария на странице /reports/churn/not-renewed (UnprolongedComment)" },
        ],
        status: "ok",
      },
      {
        id: "CRM-25",
        name: "Средний чек",
        data: [
          { what: "Оплата: сумма, дата", from: "Диалог «Принять оплату» в /finance/payments или карточке клиента" },
          { what: "Количество платежей в периоде", from: "Авто (COUNT по таблице оплат)" },
        ],
        status: "ok",
      },
      {
        id: "CRM-26",
        name: "Средняя стоимость абонемента",
        data: [
          { what: "Абонемент: отработанная сумма", from: "Авто (chargedAmount растёт при отметке посещений)" },
          { what: "Активные абонементы за месяц (со списаниями)", from: "Авто (фильтр по наличию посещений со списанием)" },
        ],
        status: "ok",
      },
      {
        id: "CRM-27",
        name: "Конверсия оттока по педагогам",
        data: [
          { what: "Абонемент: группа → педагог", from: "Группа задаётся в диалоге «Новый абонемент»; педагог группы — поле в /schedule/groups (или замена через диалог в карточке группы)" },
          { what: "Активные и выбывшие абонементы у педагога", from: "Авто" },
        ],
        status: "partial",
        gap: "Нет флага «исключить из оттока по педагогу» при отчислении абонемента",
      },
      {
        id: "CRM-28",
        name: "Отток по месяцам",
        data: [
          { what: "Клиент: дата продажи, дата первого платного занятия", from: "Авто (saleDate — при первой оплате или первом платном занятии; firstPaidLessonDate — при отметке посещения со списанием)" },
          { what: "Дата последнего платного занятия", from: "Авто (вычисляется на отчёте из посещений)" },
        ],
        status: "ok",
      },
      {
        id: "CRM-29",
        name: "Отток по направлениям и филиалам",
        data: [
          { what: "Активные и выбывшие абонементы", from: "Авто по периодам и наличию следующего абонемента" },
          { what: "Признак «закончил курс обучения» vs «ушёл с направления»", from: "Нет источника — в UI нет выбора типа причины при отчислении (нужен справочник)" },
        ],
        status: "missing",
        gap: "В коде /reports/churn-by-directions колонка completedCourse всегда возвращает 0. Нужна модель WithdrawalReason с полем type (LEFT / COMPLETED / OTHER) либо отдельное поле isCourseCompleted в абонементе",
      },
      {
        id: "CRM-30",
        name: "Лиды по дням",
        data: [
          { what: "Клиент: дата создания, канал привлечения", from: "Дата — авто; канал — Select в диалоге «Новый клиент»" },
          { what: "Абонемент: дата создания", from: "Авто при создании в карточке клиента" },
        ],
        status: "ok",
      },
      {
        id: "CRM-31",
        name: "Пробники по дням",
        data: [
          { what: "Пробное занятие: дата назначения, дата фактического посещения", from: "Диалог «Записать на пробное» (scheduledDate); attendedAt — отметка занятия" },
          { what: "Клиент: дата продажи", from: "Авто (saleDate при первой оплате или первом платном занятии)" },
        ],
        status: "ok",
      },
      {
        id: "CRM-32",
        name: "Не пришли на пробники",
        data: [
          { what: "Пробное занятие: статус «не пришёл» / «отменено»", from: "Отметка занятия в карточке lesson или авто (если дата прошла и нет attendedAt)" },
        ],
        status: "ok",
      },
      {
        id: "CRM-33 / CALL-05",
        name: "Эффективность обзвонов",
        data: [
          { what: "Кампания обзвона: название, период, ответственный", from: "Диалог «Новая кампания» в /crm/calls (CreateCampaignDialog), фильтры по статусу/сегменту" },
          { what: "Звонок в кампании: статус, результат", from: "Карточка кампании /crm/calls/[id] — компонент call-item-row (Select результата, поле комментария)" },
        ],
        status: "partial",
        gap: "Поле «результат» — свободная строка (нет enum), значения произвольные. Нет поля «дата закрытия кампании»",
      },
      {
        id: "CRM-34",
        name: "Загруженность центра",
        data: [
          { what: "Филиал: часы работы, рабочие дни недели", from: "Wizard онбординга (шаг «Филиал») или редактирование в /settings — поля workingHoursStart/End/workingDays" },
          { what: "Кабинет: вместимость", from: "Wizard онбординга (шаг «Филиал») — параметр capacity у Room" },
          { what: "Занятие: длительность, посещения", from: "Шаблон группы в /schedule/groups (durationMinutes) + отметка посещений" },
        ],
        status: "ok",
      },
      {
        id: "CRM-35",
        name: "Продажи менеджеров по каналам",
        data: [
          { what: "Клиент: ответственный менеджер, канал привлечения", from: "Поля в диалоге «Новый клиент» (/crm/leads)" },
          { what: "Пробное занятие: даты", from: "Диалог «Записать на пробное»" },
          { what: "Клиент: дата продажи, дата первого платного занятия", from: "Авто (saleDate / firstPaidLessonDate триггерятся событиями)" },
        ],
        status: "ok",
      },
      {
        id: "CRM-36",
        name: "Сводный по абонементам в разрезе педагогов",
        data: [
          { what: "Абонемент: группа → педагог", from: "Группа — диалог «Новый абонемент»; педагог — поле группы в /schedule/groups" },
          { what: "Посещения со списаниями", from: "Отметка явок в карточке занятия" },
        ],
        status: "ok",
      },
      {
        id: "CRM-37",
        name: "Сколько денег приносит педагог",
        data: [
          { what: "Посещение: сумма списания (выручка), ЗП инструктора", from: "Отметка занятия (списание — авто из lessonPrice абонемента, ЗП — авто по ставке)" },
          { what: "Расход: переменные (со склада, по кабинету)", from: "Перемещение со склада в кабинет в /stock/movements (StockMovement type=transfer)" },
          { what: "Расход: постоянные (распределяются пропорционально)", from: "Диалог «Новый расход» в /finance/expenses" },
        ],
        status: "ok",
      },
      {
        id: "CRM-38",
        name: "Детализация пробников",
        data: [
          { what: "Пробные занятия: все записи с полным составом полей", from: "Диалог «Записать на пробное» в карточке лида (LeadStatusActions)" },
        ],
        status: "ok",
      },
    ],
  },
  {
    key: "sch",
    title: "Расписание",
    icon: Calendar,
    color: "text-green-600",
    reports: [
      {
        id: "SCH-15",
        name: "Свободные места",
        data: [
          { what: "Группа: лимит мест", from: "Поле maxStudents в диалоге «Новая группа» (/schedule/groups)" },
          { what: "Зачисление в группу: активный, статус оплаты", from: "Зачисление через карточку группы; статус (active / awaiting_payment / trial) — авто по оплатам и пробному" },
          { what: "Пробное занятие: записан на пробное", from: "Диалог «Записать на пробное» в карточке лида" },
        ],
        status: "ok",
      },
    ],
  },
  {
    key: "att",
    title: "Посещения",
    icon: GraduationCap,
    color: "text-emerald-600",
    reports: [
      {
        id: "ATT-09",
        name: "Неотмеченные дети",
        data: [
          { what: "Занятие: дата прошла", from: "Авто из расписания (генерация по шаблону группы)" },
          { what: "Посещение: отсутствует запись по ученику", from: "Авто (нет строки в Attendance после прохода даты занятия)" },
        ],
        status: "ok",
      },
      {
        id: "ATT-10",
        name: "Потенциальный отток (3+ прогула подряд)",
        data: [
          { what: "Посещение: тип = прогул, дата отметки", from: "Кнопка «Прогул» в attendance-table карточки занятия" },
          { what: "Последовательность прогулов по клиенту", from: "Авто (анализ цепочки посещений)" },
        ],
        status: "ok",
      },
      {
        id: "ATT-11",
        name: "По посещениям",
        data: [
          { what: "Посещение: тип (явка / прогул / перерасчёт / отработка), дата", from: "Отметка в attendance-table карточки занятия" },
          { what: "Справочник видов дня", from: "Системные 4 предустановленных типа + добавление через настройки (если включено)" },
        ],
        status: "ok",
      },
      {
        id: "ATT-12",
        name: "Отсутствие учеников / потери выручки",
        data: [
          { what: "Посещение: сумма списания", from: "Авто (формула из lessonPrice абонемента при отметке)" },
          { what: "Вид дня: признак «списывает с абонемента» / «считается в выручку»", from: "Поля chargesSubscription/countsAsRevenue в системном справочнике" },
          { what: "Подсчёт перерасчётов vs прогулов", from: "Авто" },
        ],
        status: "ok",
      },
      {
        id: "ATT-14",
        name: "Сверка актива",
        data: [
          { what: "Клиент: статус «в активе»", from: "Авто (funnelStatus = active_client)" },
          { what: "Оплата за текущий месяц", from: "Диалог «Принять оплату»" },
          { what: "Посещения со списанием (абонемент активирован)", from: "Отметка явок в attendance-table" },
          { what: "Дата последнего посещения, дней без посещений", from: "Авто (MAX(date) по Attendance со статусом «явка»)" },
        ],
        status: "ok",
      },
    ],
  },
  {
    key: "fin",
    title: "Финансы",
    icon: CreditCard,
    color: "text-purple-600",
    reports: [
      {
        id: "FIN-06",
        name: "Должники",
        data: [
          { what: "Абонемент: полная сумма, отработанная сумма, баланс", from: "Авто (totalAmount — из расписания группы × lessonPrice; chargedAmount — из посещений; balance — из оплат)" },
          { what: "Клиент: баланс, обещанная дата оплаты", from: "Поле «Обещанная дата оплаты» в карточке клиента (требует UI-проверки)" },
        ],
        status: "ok",
      },
      {
        id: "FIN-07",
        name: "Оплаты",
        data: [
          { what: "Оплата: способ, дата, сумма, привязка к абонементу", from: "Диалог «Принять оплату» (/finance/payments) — Select способа, абонемента, счёта" },
          { what: "Абонемент, скидка, группа, педагог", from: "Авто из связей при оплате" },
        ],
        status: "ok",
      },
      {
        id: "FIN-08",
        name: "ДДС (движение денежных средств)",
        data: [
          { what: "Оплаты (приход)", from: "Диалог «Принять оплату»" },
          { what: "Расходы (списания)", from: "Диалог «Новый расход» в /finance/expenses" },
          { what: "Внутренние операции: выемки, инкассации, переводы между счетами", from: "Отображаются на /finance/cash, но **диалога создания нет** — данные попадают только через API/сидер" },
        ],
        status: "partial",
        gap: "В UI нет формы создания AccountOperation (выемка/инкассация/перевод) — есть только просмотр на /finance/cash и API. Для работы партнёра нужен AddOperationDialog",
      },
      {
        id: "FIN-09",
        name: "Остаток денег",
        data: [
          { what: "Счёт/Касса: баланс на дату", from: "Авто (агрегат оплат/расходов/операций); сам счёт создаётся в диалоге AddAccountDialog в /finance/cash" },
        ],
        status: "ok",
      },
      {
        id: "FIN-10",
        name: "Ожидаемые поступления",
        data: [
          { what: "Абонемент: полная сумма, отработанная сумма", from: "Авто (totalAmount при создании, chargedAmount при отметке посещений)" },
          { what: "Оплата: дата, сумма", from: "Диалог «Принять оплату»" },
          { what: "Неоплаченные абонементы за период", from: "Авто (фильтр по balance > 0)" },
        ],
        status: "ok",
      },
      {
        id: "FIN-11",
        name: "Выручка (отработанные абонементы)",
        data: [
          { what: "Посещение: сумма списания (= выручка)", from: "Отметка явки в attendance-table — chargeAmount считается автоматически по lessonPrice абонемента" },
        ],
        status: "ok",
      },
      {
        id: "FIN-12",
        name: "Прогноз прибыли",
        data: [
          { what: "Активные абонементы (планируемая сумма)", from: "Авто (totalAmount активных)" },
          { what: "Ставки ЗП + будущие занятия из расписания", from: "Будущие занятия — из шаблона группы (/schedule/groups); **ставки ЗП — UI отсутствует**" },
          { what: "Среднее по складу (переменные расходы)", from: "Перемещения в кабинеты на /stock/movements" },
          { what: "Плановые расходы по статьям", from: "Диалог в /finance/planned-expenses" },
        ],
        status: "partial",
        gap: "Нет UI для редактирования SalaryRate — ставки задаются только через seed/API. Без UI владелец не может настроить ставку педагога после онбординга",
      },
      {
        id: "FIN-14",
        name: "Финрез формат A (общий P&L)",
        data: [
          { what: "Посещения: суммы списаний (выручка)", from: "Отметка явок в attendance-table" },
          { what: "Расходы с амортизацией", from: "Диалог «Новый расход» — поля «амортизация N месяцев», «дата начала амортизации»" },
        ],
        status: "ok",
      },
      {
        id: "FIN-15",
        name: "Финрез формат B (направления / филиалы)",
        data: [
          { what: "Абонемент: направление", from: "Select направления в диалоге «Новый абонемент»" },
          { what: "Группа: филиал", from: "Select филиала в диалоге «Новая группа» (/schedule/groups)" },
          { what: "Привязка расхода к филиалу / направлению", from: "Чекбоксы филиалов и направлений в диалоге «Новый расход»" },
        ],
        status: "ok",
      },
      {
        id: "FIN-15a",
        name: "Финрез формат C (группа)",
        data: [
          { what: "Выручка группы (посещения по группе)", from: "Авто (фильтр посещений по subscription.groupId)" },
          { what: "ЗП инструктора за группу", from: "Авто (instructorPayAmount посещений группы)" },
          { what: "Доля переменных расходов (по кол-ву занятий)", from: "Авто (StockMovement в кабинет × кол-во занятий группы / общее)" },
          { what: "Доля постоянных расходов (по выручке)", from: "Авто (Expense × выручка группы / выручка филиала)" },
        ],
        status: "ok",
      },
      {
        id: "FIN-20",
        name: "Поступления по дням",
        data: [
          { what: "Оплата: дата, способ оплаты", from: "Диалог «Принять оплату» (поля date, method)" },
          { what: "Счёт/Касса", from: "Select счёта в диалоге «Принять оплату»" },
        ],
        status: "ok",
      },
      {
        id: "FIN-23",
        name: "Расчёты с учениками",
        data: [
          { what: "Абонемент: полная сумма, отработанная сумма, баланс", from: "Авто (расчёт из расписания, посещений и оплат)" },
          { what: "Оплата по клиенту в периоде", from: "Диалог «Принять оплату»" },
        ],
        status: "ok",
      },
      {
        id: "FIN-24",
        name: "Календарь постоянных платежей",
        data: [
          { what: "Плановый расход: статья, плановая и фактическая сумма", from: "Диалог в /finance/planned-expenses" },
          { what: "Расход: флаг «повторяющийся»", from: "Чекбокс «Повторяющийся» в диалоге «Новый расход»" },
          { what: "Ставки ЗП (для авто-подтягивания зарплат)", from: "**UI отсутствует** — ставки задаются через seed/API" },
        ],
        status: "partial",
        gap: "Без UI для SalaryRate владелец не может корректировать ставки педагогов — план ЗП в календаре платежей будет неточным",
      },
      {
        id: "FIN-25",
        name: "Связанные скидки",
        data: [
          { what: "Скидка: тип «связанная», клиент-основание", from: "Раздел «Скидка» в EditSubscriptionDialog (карточка клиента → абонемент) — выбор типа «связанная» и клиента-основания" },
          { what: "Клиент: статус в воронке, дата отчисления", from: "Авто (funnelStatus, withdrawalDate при отчислении абонемента)" },
        ],
        status: "ok",
      },
      {
        id: "FIN-28",
        name: "Остатки оплаченных занятий",
        data: [
          { what: "Абонемент: количество занятий, дата окончания", from: "Авто (totalLessons и endDate из расписания группы при создании абонемента)" },
          { what: "Количество отмеченных посещений", from: "Авто (счётчик Attendance по абонементу)" },
        ],
        status: "ok",
      },
      {
        id: "FIN-29",
        name: "Доход от новых / упущенный по выбывшим",
        data: [
          { what: "Клиент: дата первого платного занятия (новые)", from: "Авто (firstPaidLessonDate при отметке первого посещения со списанием)" },
          { what: "Клиент: дата отчисления", from: "Авто (withdrawalDate при отчислении абонемента)" },
          { what: "Посещение: сумма списания", from: "Отметка явки в attendance-table" },
        ],
        status: "ok",
      },
      {
        id: "FIN-30",
        name: "% распределения финреза",
        data: [
          { what: "Расход: сумма по статьям", from: "Диалог «Новый расход» — Select категории (статьи расхода)" },
          { what: "Выручка как база для %", from: "Авто (отработанные суммы за период)" },
        ],
        status: "ok",
      },
      {
        id: "FIN-31",
        name: "Контроль корректировок занятий (аудит)",
        data: [
          { what: "Аудит-лог: изменения суммы списания в посещениях", from: "Должен записываться автоматически при ручной правке chargeAmount в attendance-table" },
          { what: "Кто изменил, когда, было / стало", from: "Авто из AuditLog (employeeId, createdAt, changes JSON)" },
        ],
        status: "partial",
        gap: "Поля для лога есть, но нужно проверить, что бэкенд действительно пишет в AuditLog при ручной правке chargeAmount",
      },
      {
        id: "FIN-32",
        name: "Контроль скидок (аудит)",
        data: [
          { what: "Аудит-лог: создание разовых скидок", from: "Должен записываться при создании Discount type=one_time в EditSubscriptionDialog" },
          { what: "Скидка: создатель, дата, сумма", from: "Поля createdBy/createdAt/value заполняются автоматически при создании скидки" },
        ],
        status: "partial",
        gap: "Зависит от того, что create/update Discount пишет в AuditLog — нужно проверить покрытие",
      },
    ],
  },
  {
    key: "sal",
    title: "Зарплата",
    icon: Wallet,
    color: "text-amber-600",
    reports: [
      {
        id: "SAL-12",
        name: "Мотивация администратора",
        data: [
          { what: "Настройки бонусов администратора: за пробное / за продажу / за допродажу", from: "Страница /settings/admin-bonus — диалог настройки сумм по типам бонусов" },
          { what: "Пробное занятие: создатель", from: "Авто (createdBy при создании TrialLesson в LeadStatusActions)" },
          { what: "Абонемент: создатель, флаг первичности", from: "Авто (createdBy при создании; первичность — по totalSubscriptionsCount клиента)" },
          { what: "Клиент: общее количество абонементов", from: "Авто" },
        ],
        status: "ok",
      },
      {
        id: "SAL-15",
        name: "Прогноз сдельной оплаты",
        data: [
          { what: "Ставка ЗП: схема (за ученика / за занятие / фикс+за ученика)", from: "**UI отсутствует** — задаётся только через seed/API" },
          { what: "Будущие занятия из расписания", from: "Шаблон группы в /schedule/groups + помесячная генерация" },
          { what: "Зачисления в группу: активные", from: "Зачисление учеников в карточке группы" },
        ],
        status: "partial",
        gap: "Нет диалога редактирования SalaryRate в карточке сотрудника (/staff) или в /salary. Без него партнёр не сможет настроить ставки",
      },
      {
        id: "SAL-16",
        name: "Часы педагогов по дням",
        data: [
          { what: "Посещение: хотя бы один отмеченный ученик", from: "Отметка явки в attendance-table карточки занятия" },
          { what: "Занятие: длительность, основной/заменяющий инструктор", from: "Длительность — из шаблона группы; заменяющий — диалог «Заменить инструктора» в карточке занятия" },
        ],
        status: "ok",
      },
      {
        id: "SAL-17",
        name: "Средняя ЗП педагогов",
        data: [
          { what: "Сумма начислений (по посещениям)", from: "Авто (sum instructorPayAmount)" },
          { what: "Отработанные часы", from: "Авто (из отмеченных посещений × длительность занятия)" },
        ],
        status: "ok",
      },
      {
        id: "SAL-18",
        name: "Расчёты с педагогами",
        data: [
          { what: "Выплаты ЗП", from: "Диалог «Выплатить» в /salary (pay-salary-dialog) — выбор счёта, суммы, периода" },
          { what: "Премии и штрафы", from: "Компонент SalaryCorrections в /salary — поля «премия» / «штраф» с комментарием" },
          { what: "Начисления по посещениям", from: "Авто (instructorPayAmount по отмеченным посещениям)" },
        ],
        status: "ok",
      },
    ],
  },
  {
    key: "inv",
    title: "Склад",
    icon: Package,
    color: "text-rose-600",
    reports: [
      {
        id: "INV-06",
        name: "Остатки по филиалам и кабинетам",
        data: [
          { what: "Остатки на складе филиала", from: "Авто (StockBalance пересчитывается после закупки)" },
          { what: "Остатки в кабинете", from: "Авто (RoomBalance пересчитывается после перемещения и списания в /stock/movements)" },
          { what: "Товар склада: название, единица измерения, цена", from: "Диалог «Создать товар» в /stock" },
        ],
        status: "ok",
      },
    ],
  },
]

// ───────────────────────────────────────────────────────────────────────────
// КОНФИГ ОФОРМЛЕНИЯ
// ───────────────────────────────────────────────────────────────────────────

const statusConfig: Record<Status, {
  label: string
  icon: typeof CheckCircle2
  badgeClass: string
  rowClass: string
}> = {
  ok: {
    label: "Данные есть",
    icon: CheckCircle2,
    badgeClass:
      "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-900",
    rowClass: "",
  },
  partial: {
    label: "Частично",
    icon: AlertTriangle,
    badgeClass:
      "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-900",
    rowClass: "bg-amber-50/40 dark:bg-amber-950/10",
  },
  missing: {
    label: "Не хватает",
    icon: XCircle,
    badgeClass:
      "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-900",
    rowClass: "bg-red-50/50 dark:bg-red-950/10",
  },
}

// ───────────────────────────────────────────────────────────────────────────
// КОМПОНЕНТЫ
// ───────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Status }) {
  const cfg = statusConfig[status]
  const Icon = cfg.icon
  return (
    <Badge variant="outline" className={`gap-1 ${cfg.badgeClass}`}>
      <Icon className="size-3" />
      {cfg.label}
    </Badge>
  )
}

function ReportRow({ report }: { report: Report }) {
  const cfg = statusConfig[report.status]
  return (
    <TableRow className={cfg.rowClass}>
      <TableCell className="whitespace-nowrap align-top font-mono text-xs text-muted-foreground">
        {report.id}
      </TableCell>
      <TableCell className="align-top font-medium whitespace-normal">
        {report.name}
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <ol className="ml-4 list-decimal space-y-1 text-sm marker:text-muted-foreground">
          {report.data.map((d, i) => (
            <li key={i}>{d.what}</li>
          ))}
        </ol>
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <ol className="ml-4 list-decimal space-y-1 text-sm text-muted-foreground marker:text-muted-foreground/60">
          {report.data.map((d, i) => (
            <li key={i}>{d.from}</li>
          ))}
        </ol>
      </TableCell>
      <TableCell className="align-top whitespace-nowrap">
        <StatusBadge status={report.status} />
      </TableCell>
      <TableCell className="align-top whitespace-normal text-sm text-muted-foreground">
        {report.gap || (
          <span className="text-xs text-muted-foreground/50">—</span>
        )}
      </TableCell>
    </TableRow>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// СТРАНИЦА
// ───────────────────────────────────────────────────────────────────────────

export default function RepsPage() {
  const [filter, setFilter] = useState<"all" | Status>("all")

  const counts = useMemo(() => {
    const c = { all: 0, ok: 0, partial: 0, missing: 0 }
    for (const m of modules) {
      for (const r of m.reports) {
        c.all += 1
        c[r.status] += 1
      }
    }
    return c
  }, [])

  const visibleModules = useMemo(() => {
    if (filter === "all") return modules
    return modules
      .map((m) => ({ ...m, reports: m.reports.filter((r) => r.status === filter) }))
      .filter((m) => m.reports.length > 0)
  }, [filter])

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div>
        <h1 className="text-2xl font-bold">Отчёты MVP × данные системы</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Сводка по всем отчётам, требуемым в MVP (1 июня 2026) — какие данные нужны,
          откуда они берутся в текущем UI и где есть пробелы.
        </p>
      </div>

      {/* Метрики */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-lg border p-4 text-left transition-colors ${
            filter === "all" ? "border-foreground" : "hover:bg-muted/40"
          }`}
        >
          <p className="text-2xl font-bold">{counts.all}</p>
          <p className="text-xs text-muted-foreground">всего отчётов</p>
        </button>
        <button
          onClick={() => setFilter("ok")}
          className={`rounded-lg border p-4 text-left transition-colors ${
            filter === "ok"
              ? "border-green-500"
              : "hover:bg-green-50 dark:hover:bg-green-950/20"
          }`}
        >
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {counts.ok}
          </p>
          <p className="text-xs text-muted-foreground">данные есть</p>
        </button>
        <button
          onClick={() => setFilter("partial")}
          className={`rounded-lg border p-4 text-left transition-colors ${
            filter === "partial"
              ? "border-amber-500"
              : "hover:bg-amber-50 dark:hover:bg-amber-950/20"
          }`}
        >
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
            {counts.partial}
          </p>
          <p className="text-xs text-muted-foreground">частично</p>
        </button>
        <button
          onClick={() => setFilter("missing")}
          className={`rounded-lg border p-4 text-left transition-colors ${
            filter === "missing"
              ? "border-red-500"
              : "hover:bg-red-50 dark:hover:bg-red-950/20"
          }`}
        >
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">
            {counts.missing}
          </p>
          <p className="text-xs text-muted-foreground">не хватает</p>
        </button>
      </div>

      {/* Легенда */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-green-600" />
              <span className="font-medium">Данные есть</span>
              <span className="text-muted-foreground">— все поля присутствуют и заполняются через UI</span>
            </span>
            <span className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-600" />
              <span className="font-medium">Частично</span>
              <span className="text-muted-foreground">— отчёт работает, но часть колонок не полная или нет UI для ввода</span>
            </span>
            <span className="flex items-center gap-2">
              <XCircle className="size-4 text-red-600" />
              <span className="font-medium">Не хватает</span>
              <span className="text-muted-foreground">— ключевые данные отсутствуют ни в схеме, ни в UI</span>
            </span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Колонки «Требуемые данные» и «Откуда берём» — нумерованные параллельные списки: пункт №1 слева
            соответствует источнику №1 справа.
          </p>
        </CardContent>
      </Card>

      {/* Таблицы по модулям */}
      {visibleModules.map((mod) => {
        const ModIcon = mod.icon
        return (
          <Card key={mod.key}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ModIcon className={`size-5 ${mod.color}`} />
                {mod.title}
                <Badge variant="secondary" className="ml-1 font-normal">
                  {mod.reports.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[110px]">ID</TableHead>
                    <TableHead className="w-[200px]">Отчёт</TableHead>
                    <TableHead className="w-[280px]">Требуемые данные</TableHead>
                    <TableHead className="w-[360px]">Откуда берём</TableHead>
                    <TableHead className="w-[130px]">Статус</TableHead>
                    <TableHead className="w-[280px]">Чего не хватает</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mod.reports.map((r) => (
                    <ReportRow key={r.id} report={r} />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      })}

      {/* Сводный блок пробелов */}
      <Card className="border-amber-200 dark:border-amber-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-5 text-amber-600" />
            Что нужно добавить — в схему БД и в UI
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="ml-4 list-decimal space-y-3 text-sm">
            <li>
              <span className="font-medium">Справочник «Причины отчисления»</span>
              <span className="text-muted-foreground">
                {" "}— модель <code className="rounded bg-muted px-1 py-0.5 text-xs">WithdrawalReason</code> с типом{" "}
                <em>«ушёл с направления»</em> / <em>«закончил курс»</em> / <em>«другое»</em> + страница{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">/settings/withdrawal-reasons</code> и Select в форме отчисления.
                Закроет CRM-23, CRM-29.
              </span>
            </li>
            <li>
              <span className="font-medium">
                Флаги «исключить из отчёта оттока» в форме отчисления
              </span>
              <span className="text-muted-foreground">
                {" "}— чекбоксы «отток по направлению» и «отток по педагогу» в диалоге отчисления абонемента.
                Закроет CRM-23, CRM-27, CRM-29.
              </span>
            </li>
            <li>
              <span className="font-medium">UI редактирования ставок ЗП (SalaryRate)</span>
              <span className="text-muted-foreground">
                {" "}— диалог в карточке сотрудника <code className="rounded bg-muted px-1 py-0.5 text-xs">/staff/[id]</code> или
                на странице <code className="rounded bg-muted px-1 py-0.5 text-xs">/salary</code>: схема (per_student / per_lesson / fixed_plus_per_student),
                сумма по направлениям. Закроет FIN-12, FIN-24, SAL-15.
              </span>
            </li>
            <li>
              <span className="font-medium">Диалог создания внутренних операций (AccountOperation)</span>
              <span className="text-muted-foreground">
                {" "}— на странице <code className="rounded bg-muted px-1 py-0.5 text-xs">/finance/cash</code> добавить кнопку
                «Выемка / инкассация / перевод между счетами». Закроет FIN-08 (ДДС).
              </span>
            </li>
            <li>
              <span className="font-medium">Enum для результата звонка + дата закрытия кампании</span>
              <span className="text-muted-foreground">
                {" "}— заменить <code className="rounded bg-muted px-1 py-0.5 text-xs">CallCampaignItem.result: String</code>
                на enum <code className="rounded bg-muted px-1 py-0.5 text-xs">CallResult</code>{" "}
                (trial_scheduled / sale / refused / no_answer / callback) и добавить <code className="rounded bg-muted px-1 py-0.5 text-xs">CallCampaign.closedAt</code>.
                Закроет CRM-33 / CALL-05.
              </span>
            </li>
            <li>
              <span className="font-medium">Проверить покрытие аудит-логом</span>
              <span className="text-muted-foreground">
                {" "}— убедиться, что бэкенд пишет в <code className="rounded bg-muted px-1 py-0.5 text-xs">AuditLog</code> при
                ручной правке суммы списания в посещении и при создании разовой скидки.
                Закроет FIN-31, FIN-32.
              </span>
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
