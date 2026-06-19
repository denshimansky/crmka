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
  /** Формула расчёта отчёта (как считается ключевая метрика) */
  formula: string
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
          { what: "Клиент: дата создания, даты первой оплаты / первого платного занятия", from: "Создание лида (авто); даты покупки — авто при оплате и отметке занятия" },
          { what: "Заявка: дата создания, исход (won)", from: "Кнопка «+ Заявка» в карточке / Продажах; won — авто при оплате абонемента" },
          { what: "Пробное занятие: дата занятия, статус (пришёл / не пришёл)", from: "Диалог «Записать на пробное»; статус — отметка в журнале занятия" },
        ],
        formula: "COUNT заявок по этапам: Лид → Заявка → Пробное → Пришёл на пробное → Купил. Вкладки «новые»/«действующие» (статус клиента на момент заявки), схемы «с пробным»/«без». Каждый этап в двух разрезах: «текущий месяц» (заявка создана в месяце) + «перетекающие» (создана раньше, действие в месяце). Клик по этапу — детализация",
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
        formula: "Конверсия = COUNT(продаж) / COUNT(пробных) × 100%. Пробные — клиенты, посетившие пробное у педагога. Продажа = первое платное занятие посещено ИЛИ первая оплата внесена (что раньше)",
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
        formula: "COUNT(Client) и COUNT(Subscription) GROUP BY channel × manager × дата создания. Дополнительно — записано на пробники, посетили пробники, совершено продаж, отток (по той же разбивке)",
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
        formula: "Все этапы воронки привязаны к дате создания абонемента (не к дате действия). Из созданных в день D: записано на пробное / посетили пробное / совершено продаж / поступила оплата — независимо когда событие произошло. Разрез по каналам",
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
        formula: "Допродажи = COUNT(Subscription WHERE previousSubscriptionId IS NOT NULL) за период. Возвраты = SUM(Payment WHERE type = refund) за период. Группировка по клиенту / направлению / периоду",
        status: "ok",
      },
      {
        id: "CRM-19",
        name: "Сегментация клиентов",
        data: [
          { what: "Клиент: сегмент (Новый / Стандарт / Постоянный / VIP)", from: "Авто по правилу: 1-3 → новый, 4-12 → стандарт, 13-18 → постоянный, 19+ → VIP" },
          { what: "Клиент: общее количество абонементов", from: "Авто (счётчик totalSubscriptionsCount пересчитывается при создании абонемента)" },
        ],
        formula: "Сегмент по числу купленных абонементов: 1–3 → Новый, 4–12 → Стандарт, 13–18 → Постоянный, 19+ → VIP. Пересчёт автоматический при создании абонемента",
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
        formula: "Дата оттока = MAX(Attendance.date WHERE chargeAmount > 0) — дата ПОСЛЕДНЕГО ПЛАТНОГО занятия (не дата уведомления и не дата административного отчисления). Выбывший = клиент без следующего абонемента",
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
        formula: "Непродлённые = клиенты с ≥1 списанием в прошлом месяце AND 0 списаний в текущем месяце. На 1 число = все активные прошлого месяца, по мере отметок исчезают из отчёта",
        status: "ok",
      },
      {
        id: "CRM-25",
        name: "Средний чек",
        data: [
          { what: "Оплата: сумма, дата", from: "Диалог «Принять оплату» в /finance/payments или карточке клиента" },
          { what: "Количество платежей в периоде", from: "Авто (COUNT по таблице оплат)" },
        ],
        formula: "Средний чек = SUM(Payment.amount) / COUNT(Payment) за период. Один платёж = один чек, даже если покрывает несколько абонементов (уровень ДДС, не абонементов)",
        status: "ok",
      },
      {
        id: "CRM-26",
        name: "Средняя стоимость абонемента",
        data: [
          { what: "Абонемент: отработанная сумма", from: "Авто (chargedAmount растёт при отметке посещений)" },
          { what: "Активные абонементы за месяц (со списаниями)", from: "Авто (фильтр по наличию посещений со списанием)" },
        ],
        formula: "Средняя стоимость абонемента = SUM(Attendance.chargeAmount) / COUNT(активные абонементы за месяц). Активный = хотя бы 1 списание в месяце (включая отчисленных)",
        status: "ok",
      },
      {
        id: "CRM-27",
        name: "Конверсия оттока по педагогам",
        data: [
          { what: "Абонемент: группа → педагог", from: "Группа задаётся в диалоге «Новый абонемент»; педагог группы — поле в /schedule/groups (или замена через диалог в карточке группы)" },
          { what: "Активные и выбывшие абонементы у педагога", from: "Авто" },
        ],
        formula: "% оттока = COUNT(выбывших абонементов) / COUNT(активных абонементов) × 100% по педагогу. При смене педагога в середине месяца активные считаются обоим — сумма по педагогам может быть больше оттока по направлениям",
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
        formula: "Месяц оттока = (Дата последнего платного занятия − Дата продажи) в полных календарных месяцах. Дата продажи = MIN(дата первой оплаты, дата первого платного занятия)",
        status: "ok",
      },
      {
        id: "CRM-29",
        name: "Отток по направлениям и филиалам",
        data: [
          { what: "Активные и выбывшие абонементы", from: "Авто по периодам и наличию следующего абонемента" },
          { what: "Признак «закончил курс обучения» vs «ушёл с направления»", from: "Нет источника — в UI нет выбора типа причины при отчислении (нужен справочник)" },
        ],
        formula: "% оттока = COUNT(выбывшие) / COUNT(активные) × 100% GROUP BY направление, филиал. Активные = ≥1 списание в прошлом И текущем месяце. «Закончили курс» — отдельный столбец, только тип «окончил курс обучения»",
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
        formula: "COUNT(Subscription) GROUP BY DATE(createdAt) × channel. Фильтры: филиал, направление",
        status: "ok",
      },
      {
        id: "CRM-32",
        name: "Не пришли на пробники",
        data: [
          { what: "Пробное занятие: статус «не пришёл»", from: "Отметка «Не пришёл» в журнале занятия" },
        ],
        formula: "COUNT(TrialLesson WHERE status = 'no_show'). Каждая неявка — отдельная запись. «Отменено» (перенос даты, удаление заявки) — технический статус, не учитывается",
        status: "ok",
      },
      {
        id: "CRM-33 / CALL-05",
        name: "Эффективность обзвонов",
        data: [
          { what: "Кампания обзвона: название, период, ответственный", from: "Диалог «Новая кампания» в /crm/calls (CreateCampaignDialog), фильтры по статусу/сегменту" },
          { what: "Звонок в кампании: статус, результат", from: "Карточка кампании /crm/calls/[id] — компонент call-item-row (Select результата, поле комментария)" },
        ],
        formula: "Всего = COUNT(items). Отработано = COUNT(WHERE status != pending). Назначено пробных = COUNT(WHERE result = trial_scheduled). Продажи = COUNT(WHERE result = sale). Не дозвонились = COUNT(WHERE result = no_answer). Отказы = COUNT(WHERE result = refused)",
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
        formula: "% загрузки = Фактическое кол-во часов / Максимальное кол-во часов × 100%. Максимум = часы работы филиала × рабочие дни × кол-во кабинетов. Факт = SUM(durationMinutes) занятий с ≥1 учеником (пустые не учитываются)",
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
        formula: "COUNT(Client) GROUP BY manager × channel: создано лидов / создано заявок / записано на пробники / совершено продаж / отток. Каждая метрика по своей дате-источнику",
        status: "ok",
      },
      {
        id: "CRM-36",
        name: "Сводный по абонементам в разрезе педагогов",
        data: [
          { what: "Абонемент: группа → педагог", from: "Группа — диалог «Новый абонемент»; педагог — поле группы в /schedule/groups" },
          { what: "Посещения со списаниями", from: "Отметка явок в карточке занятия" },
        ],
        formula: "По педагогу: Активные абонементы (≥1 списание), Новые (продажа И первое занятие с явкой в месяце), Выбывшие (нет следующего абонемента), Активные на конец месяца",
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
        formula: "Прибыльность педагога = Выручка − Зарплата − Переменные расходы (канцтовары пропорц. по занятиям) − Доля постоянных расходов. % от общего дохода = Прибыльность педагога / Общая чистая прибыль",
        status: "ok",
      },
      {
        id: "CRM-38",
        name: "Детализация пробников",
        data: [
          { what: "Пробные занятия: все записи с полным составом полей", from: "Диалог «Записать на пробное» в карточке лида (LeadStatusActions)" },
        ],
        formula: "SELECT TrialLesson WHERE period — список без агрегации. Повторные пробные по тому же абонементу подсвечиваются серым; разовые клиенты исключены",
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
        formula: "Свободно мест = Всего мест − Занято мест − Записано на пробники − Ждём оплату. % заполнения = (Всего мест − Свободно мест) / Всего мест × 100%",
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
          { what: "Посещение: отсутствует запись по ученику", from: "Авто (нет строки в Attendance ИЛИ Attendance.isPending=true после прохода даты занятия)" },
          { what: "Реестр в UI", from: "Вкладка «Неотмеченные посещения» в /lessons/absences (также дублируется на /reports/attendance/unmarked)" },
        ],
        formula: "SELECT Enrollment WHERE Lesson.date < TODAY AND NOT EXISTS(Attendance for этого ученика на этом занятии) OR Attendance.isPending=true",
        status: "ok",
      },
      {
        id: "ATT-10",
        name: "Потенциальный отток (3+ прогула подряд)",
        data: [
          { what: "Посещение: тип = прогул, дата отметки", from: "Кнопка «Прогул» в attendance-table карточки занятия" },
          { what: "Последовательность прогулов по клиенту", from: "Авто (анализ цепочки посещений)" },
        ],
        formula: "Найти клиентов с COUNT(подряд идущих Attendance WHERE type = absence) >= 3 на хвосте последовательности посещений по абонементу",
        status: "ok",
      },
      {
        id: "ATT-11",
        name: "По посещениям",
        data: [
          { what: "Посещение: тип (явка / прогул / перерасчёт / отработка), дата", from: "Отметка в attendance-table карточки занятия ИЛИ быстрая отметка по клику ячейки сетки /lessons/attendance" },
          { what: "Справочник видов дня", from: "Системные коды (present/no_show/excused/absent/recalculation/makeup/makeup_scheduled) + кастомные через /settings/attendance-types" },
          { what: "Сетка «строка-ученик × колонки-дни месяца»", from: "/lessons/attendance — фильтры филиал/кабинет/направление/педагог/группа, колонка «План» (число занятий) и «К оплате» (Subscription.balance)" },
        ],
        formula: "COUNT(Attendance) GROUP BY type × DATE. Свод: COUNT каждого вида посещения по филиалам. Сетка /lessons/attendance — UI для массовой отметки с цветной подсветкой по коду типа",
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
        formula: "Кол-во перерасчётов = COUNT(Attendance WHERE chargeAmount = 0 AND type = recalc). Сумма перерасчётов = SUM(lessonPrice) этих посещений. Кол-во прогулов = COUNT(WHERE type = absence AND chargeAmount > 0). Сумма прогулов = SUM(chargeAmount)",
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
        formula: "Расхождение = (Client.status = active) AND (НЕТ Payment за текущий месяц для абонемента) AND (НЕТ Attendance с chargeAmount > 0 за месяц). Дней без посещений = TODAY − MAX(Attendance.date WHERE status = present)",
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
        formula: "Плановый долг = SUM(Subscription.totalAmount − paidAmount) если посетит все занятия. Фактический долг = SUM(chargedAmount − paidAmount) на сегодня по отмеченным занятиям",
        status: "ok",
      },
      {
        id: "FIN-07",
        name: "Оплаты",
        data: [
          { what: "Оплата: способ, дата, сумма, привязка к абонементу", from: "Диалог «Принять оплату» (/finance/payments) — Select способа, абонемента, счёта" },
          { what: "Абонемент, скидка, группа, педагог", from: "Авто из связей при оплате" },
        ],
        formula: "SUM(Payment.amount) GROUP BY способ × дата × абонемент. Доп. столбцы: сумма без скидок, сумма скидок (разовые + постоянные), наши деньги = SUM(Attendance.chargeAmount) — отработано",
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
        formula: "Сальдо = SUM(Payment.amount) приход − SUM(Expense.amount) расход GROUP BY статья × дата. Учёт по дате фактического платежа (не по периоду назначения). Внутренние операции (AccountOperation) — отдельно, не как приход/расход",
        status: "partial",
        gap: "В UI нет формы создания AccountOperation (выемка/инкассация/перевод) — есть только просмотр на /finance/cash и API. Для работы партнёра нужен AddOperationDialog",
      },
      {
        id: "FIN-09",
        name: "Остаток денег",
        data: [
          { what: "Счёт/Касса: баланс на дату", from: "Авто (агрегат оплат/расходов/операций); сам счёт создаётся в диалоге AddAccountDialog в /finance/cash" },
        ],
        formula: "Account.balance на дату D = SUM(приход до D) − SUM(расход до D) − SUM(исходящих переводов) + SUM(входящих переводов)",
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
        formula: "Ожидаемые поступления = SUM(Subscription.totalAmount − paidAmount) WHERE активный AND период IN (предыдущий, текущий). Оплачено = Сумма абонементов − Ожидаемые. % долга = Ожидаемые / Сумма абонементов × 100%",
        status: "ok",
      },
      {
        id: "FIN-11",
        name: "Выручка (отработанные абонементы)",
        data: [
          { what: "Посещение: сумма списания (= выручка)", from: "Отметка явки в attendance-table — chargeAmount считается автоматически по lessonPrice абонемента" },
        ],
        formula: "Выручка = SUM(Attendance.chargeAmount) за период (только отработанные занятия, не оплаты). По умолчанию группировка по филиал × направление × месяц",
        status: "ok",
      },
      {
        id: "FIN-12",
        name: "Прогноз прибыли",
        data: [
          { what: "Активные абонементы (планируемая сумма)", from: "Авто (totalAmount активных)" },
          { what: "Ставки ЗП + будущие занятия из расписания", from: "Будущие занятия — из шаблона группы (/schedule/groups); ставки ЗП — диалог salary-rates-dialog в карточке сотрудника /staff/[id]" },
          { what: "Среднее по складу (переменные расходы)", from: "Перемещения в кабинеты на /stock/movements" },
          { what: "Плановые расходы по статьям", from: "Диалог в /finance/planned-expenses" },
        ],
        formula: "Прогноз прибыли = Сумма абонементов − Прогноз ЗП педагогов − Прогноз переменных расходов − Прогноз постоянных платежей. Прогноз ЗП — авто (расписание × ставки). Перемен. — среднее со склада. Постоян. — вручную (план)",
        status: "ok",
      },
      {
        id: "FIN-14",
        name: "Финрез формат A (общий P&L)",
        data: [
          { what: "Посещения: суммы списаний (выручка)", from: "Отметка явок в attendance-table" },
          { what: "Расходы с амортизацией", from: "Диалог «Новый расход» — поля «амортизация N месяцев», «дата начала амортизации»" },
        ],
        formula: "Прибыль = Доход − Расход. Доход = SUM(Attendance.chargeAmount) за месяц. Расход = SUM(Expense.amount) по периоду назначения (не по дате платежа) + амортизационные доли = Expense.amount / amortMonths за каждый месяц периода",
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
        formula: "Прибыль направления = Доход направления − Прямые расходы − Доля общих расходов. Доля общих = Расход центра × (Доход направления / Доход филиала). Структура: Филиал → Направление → Статья расхода",
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
        formula: "Прибыль группы = Выручка − ЗП инструктора − Доля переменных − Доля постоянных. Доля переменных = Перем. филиала × (Зан. группы / Всего зан. филиала). Доля постоянных = Пост. филиала × (Выручка группы / Выручка филиала). Рентабельность = Прибыль / Выручка × 100%",
        status: "ok",
      },
      {
        id: "FIN-20",
        name: "Поступления по дням",
        data: [
          { what: "Оплата: дата, способ оплаты", from: "Диалог «Принять оплату» (поля date, method)" },
          { what: "Счёт/Касса", from: "Select счёта в диалоге «Принять оплату»" },
        ],
        formula: "SUM(Payment.amount) GROUP BY DATE × способ (нал/безнал). Второй вид: GROUP BY DATE × Account. Фильтры: только от клиентов / все платежи, по филиалу",
        status: "ok",
      },
      {
        id: "FIN-23",
        name: "Расчёты с учениками",
        data: [
          { what: "Абонемент: полная сумма, отработанная сумма, баланс", from: "Авто (расчёт из расписания, посещений и оплат)" },
          { what: "Оплата по клиенту в периоде", from: "Диалог «Принять оплату»" },
        ],
        formula: "Конечный баланс = Начальный баланс + Начисление Факт − Оплата. Начисление План = (занятия × стоимость − перерасчёты). Начисление Факт = SUM(Attendance.chargeAmount) за месяц",
        status: "ok",
      },
      {
        id: "FIN-24",
        name: "Календарь постоянных платежей",
        data: [
          { what: "Плановый расход: статья, плановая и фактическая сумма", from: "Диалог в /finance/planned-expenses" },
          { what: "Расход: флаг «повторяющийся»", from: "Чекбокс «Повторяющийся» в диалоге «Новый расход»" },
          { what: "Ставки ЗП (для авто-подтягивания зарплат)", from: "Диалог salary-rates-dialog в карточке сотрудника /staff/[id] (схема + сумма по направлениям)" },
        ],
        formula: "К оплате = План − Оплачено по каждой статье ДДС. ЗП педагогов — авто из ставок (не вручную)",
        status: "ok",
      },
      {
        id: "FIN-25",
        name: "Действующие скидки",
        data: [
          { what: "Скидка: источник (автоскидка за 2-й абонемент / постоянная / старая логика), скидка за занятие, сумма", from: "Subscription.discountSource/discountPerLesson/discountAmount — выставляются автоматическим пересчётом (recalcClientDiscounts) и тогглом автоскидки в Настройках → Шаблоны скидок" },
          { what: "Шаблон скидки", from: "Активная Discount-запись абонемента → DiscountTemplate.name" },
        ],
        formula: "SELECT Subscription WHERE status IN (pending, active) AND discountSource != none. Для каждого: родитель, ребёнок, направление, группа, период, тип скидки, скидка за занятие, сумма скидки",
        status: "ok",
      },
      {
        id: "FIN-28",
        name: "Остатки оплаченных занятий",
        data: [
          { what: "Абонемент: количество занятий, дата окончания", from: "Авто (totalLessons и endDate из расписания группы при создании абонемента)" },
          { what: "Количество отмеченных посещений", from: "Авто (счётчик Attendance по абонементу)" },
        ],
        formula: "Остаток занятий = Subscription.totalLessons − COUNT(Attendance) по абонементу. Баланс на сегодня = totalAmount − chargedAmount. У выбывших с остатком денег остатки = 0 (стоимость может измениться при возврате)",
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
        formula: "Доход от новых = SUM(Attendance.chargeAmount) у клиентов с firstPaidLessonDate IN период. Факт упущенного = SUM(стоимости несостоявшихся занятий до конца месяца у выбывших). План упущенного следующего месяца = средняя стоимость абонемента × кол-во выбывших",
        status: "ok",
      },
      {
        id: "FIN-30",
        name: "% распределения финреза",
        data: [
          { what: "Расход: сумма по статьям", from: "Диалог «Новый расход» — Select категории (статьи расхода)" },
          { what: "Выручка как база для %", from: "Авто (отработанные суммы за период)" },
        ],
        formula: "% по статье = SUM(Expense.amount по статье) / SUM(Attendance.chargeAmount всего) × 100%. Чистая прибыль = Доходы − ВСЕ расходы. Только после закрытия месяца",
        status: "ok",
      },
      {
        id: "FIN-31",
        name: "Контроль корректировок занятий (аудит)",
        data: [
          { what: "Аудит-лог: изменения суммы списания в посещениях", from: "Авто: logAudit(...) вызывается в POST/DELETE /api/lessons/[id]/attendance при любой отметке/смене/сбросе" },
          { what: "Кто изменил, когда, было / стало", from: "Авто из AuditLog (employeeId, createdAt, changes JSON)" },
        ],
        formula: "SELECT AuditLog WHERE entity = Attendance AND field = chargeAmount. Разница = новое значение − старое. Период по changedAt",
        status: "ok",
      },
      {
        id: "FIN-32",
        name: "Контроль скидок (аудит)",
        data: [
          { what: "Аудит-лог: создание разовых скидок", from: "Должен записываться при создании Discount type=one_time в EditSubscriptionDialog" },
          { what: "Скидка: создатель, дата, сумма", from: "Поля createdBy/createdAt/value заполняются автоматически при создании скидки" },
        ],
        formula: "SELECT AuditLog WHERE entity = Discount AND type = one_time AND action = create. Сумма скидки = Discount.value",
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
        formula: "Бонус за пробные = COUNT(TrialLesson WHERE status = completed AND createdBy = admin) × AdminBonusSettings.amount(per_trial). Аналогично для продаж новым (первые Subscription) и допродаж (не первые). Итого ЗП = Оклад + Итого бонус",
        status: "ok",
      },
      {
        id: "SAL-15",
        name: "Прогноз сдельной оплаты",
        data: [
          { what: "Ставка ЗП: схема (за ученика / за занятие / фикс+за ученика)", from: "Диалог salary-rates-dialog в карточке сотрудника /staff/[id]: выбор схемы (SCHEME_LABELS) и суммы по направлениям" },
          { what: "Будущие занятия из расписания", from: "Шаблон группы в /schedule/groups + помесячная генерация" },
          { what: "Зачисления в группу: активные", from: "Зачисление учеников в карточке группы" },
        ],
        formula: "Сумма прогноз = SalaryRate.amount × Количество (база). База зависит от схемы: per_student → активные ученики на занятиях, per_lesson → кол-во занятий, fixed_plus_per_student → оклад + per_student. К оплате = Прогноз − Выплачено",
        status: "ok",
      },
      {
        id: "SAL-16",
        name: "Часы педагогов по дням",
        data: [
          { what: "Посещение: хотя бы один отмеченный ученик", from: "Отметка явки в attendance-table карточки занятия" },
          { what: "Занятие: длительность, основной/заменяющий инструктор", from: "Длительность — из шаблона группы; заменяющий — диалог «Заменить инструктора» в карточке занятия" },
        ],
        formula: "Часы за день = SUM(Lesson.durationMinutes WHERE есть ≥1 Attendance с явкой) / 60. На заменяющего инструктора часы засчитываются ему, а не основному",
        status: "ok",
      },
      {
        id: "SAL-17",
        name: "Средняя ЗП педагогов",
        data: [
          { what: "Сумма начислений (по посещениям)", from: "Авто (sum instructorPayAmount)" },
          { what: "Отработанные часы", from: "Авто (из отмеченных посещений × длительность занятия)" },
        ],
        formula: "Средняя стоимость часа = SUM(instructorPayAmount) / SUM(часы). Возможен выбор нескольких месяцев для динамики",
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
        formula: "Осталось выплатить = Начислено + Премии − Штрафы − Выплачено. Начислено = SUM(Attendance.instructorPayAmount). Аванс и зарплата считаются раздельно (1-я и 2-я половины месяца)",
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
        formula: "Остаток = SUM(приход) − SUM(расход) на дату. Сумма = Остаток × StockItem.price. Итого по дням = (приходы − расходы) за месяц",
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
      <TableCell className="align-top whitespace-normal text-sm">
        <code className="block whitespace-pre-wrap rounded bg-muted/40 px-2 py-1.5 font-mono text-xs leading-relaxed">
          {report.formula}
        </code>
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
          Сводка отчётов из PRD на актуальной версии (v1.5.6-alpha) — какие данные
          нужны, откуда они берутся в текущем UI и где остаются пробелы.
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
                    <TableHead className="w-[100px]">ID</TableHead>
                    <TableHead className="w-[180px]">Отчёт</TableHead>
                    <TableHead className="w-[240px]">Требуемые данные</TableHead>
                    <TableHead className="w-[300px]">Откуда берём</TableHead>
                    <TableHead className="w-[280px]">Формула</TableHead>
                    <TableHead className="w-[120px]">Статус</TableHead>
                    <TableHead className="w-[240px]">Чего не хватает</TableHead>
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
            Что осталось — в схему БД и в UI (на v1.5.6-alpha)
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
                Сейчас поля <code className="rounded bg-muted px-1 py-0.5 text-xs">withdrawalReasonId</code> в Client/Subscription есть, но самой таблицы и страницы — нет.
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
              <span className="font-medium">completedCourse в отчёте оттока по направлениям</span>
              <span className="text-muted-foreground">
                {" "}— в <code className="rounded bg-muted px-1 py-0.5 text-xs">/reports/churn-by-directions</code> колонка
                «закончили курс» сейчас всегда 0. Зависит от справочника «Причины отчисления» (п. 1).
                Закроет CRM-29.
              </span>
            </li>
            <li>
              <span className="font-medium">Диалог создания внутренних операций (AccountOperation)</span>
              <span className="text-muted-foreground">
                {" "}— на странице <code className="rounded bg-muted px-1 py-0.5 text-xs">/finance/cash</code> сейчас есть только
                AddAccountDialog / EditAccountDialog. Нужна кнопка «Выемка / инкассация / перевод между счетами»
                (типы OP_TYPE_LABELS — owner_withdrawal / encashment / transfer — уже определены, диалога нет).
                Закроет FIN-08 (ДДС).
              </span>
            </li>
            <li>
              <span className="font-medium">Enum для результата звонка + дата закрытия кампании</span>
              <span className="text-muted-foreground">
                {" "}— заменить <code className="rounded bg-muted px-1 py-0.5 text-xs">CallCampaignItem.result: String?</code>
                на enum <code className="rounded bg-muted px-1 py-0.5 text-xs">CallResult</code>{" "}
                (trial_scheduled / sale / refused / no_answer / callback) и добавить <code className="rounded bg-muted px-1 py-0.5 text-xs">CallCampaign.closedAt</code>.
                Закроет CRM-33 / CALL-05.
              </span>
            </li>
            <li>
              <span className="font-medium">Аудит-лог разовых скидок</span>
              <span className="text-muted-foreground">
                {" "}— при создании <code className="rounded bg-muted px-1 py-0.5 text-xs">Discount</code> с
                <code className="rounded bg-muted px-1 py-0.5 text-xs">type=one_time</code> в
                EditSubscriptionDialog добавить вызов <code className="rounded bg-muted px-1 py-0.5 text-xs">logAudit(...)</code>.
                Аудит правки <code className="rounded bg-muted px-1 py-0.5 text-xs">chargeAmount</code> посещений уже работает.
                Закроет FIN-32.
              </span>
            </li>
          </ol>
          <p className="mt-4 text-xs text-muted-foreground">
            Закрыты в v1.5.6: UI редактирования SalaryRate (salary-rates-dialog в /staff/[id]) →
            FIN-12, FIN-24, SAL-15. Аудит-лог отметок посещений (logAudit в POST/DELETE
            /api/lessons/[id]/attendance) → FIN-31.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
