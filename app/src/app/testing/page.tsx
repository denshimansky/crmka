"use client"

import { useState, useEffect } from "react"

interface TestCase {
  id: string
  action: string
  expected: string
}

interface TestGroup {
  module: string
  description: string
  cases: TestCase[]
}

const testGroups: TestGroup[] = [
  {
    module: "0. Вход и онбординг",
    description: "Авторизация, первый запуск, wizard настройки",
    cases: [
      { id: "A01", action: "Открыть /dev → нажать «Демо-вход (владелец)»", expected: "Попадаем на дашборд, видим 8 виджетов с данными" },
      { id: "A02", action: "Выйти → войти заново по admin@umnayacrm.ru / admin123", expected: "Попадаем в бэк-офис /admin" },
      { id: "A03", action: "В бэк-офисе нажать «Войти как» на любую организацию", expected: "Impersonation — попадаем в CRM этой организации" },
      { id: "A04", action: "Нажать «?» (PageHelp) на любой странице", expected: "Появляется подсказка с описанием страницы" },
    ],
  },
  {
    module: "1. Дашборд",
    description: "Главная страница с виджетами",
    cases: [
      { id: "D01", action: "Проверить виджеты: активные абонементы, выручка, расходы, должники", expected: "Цифры не нулевые (демо-данные), суммы в рублях" },
      { id: "D02", action: "Кликнуть «быстрый +» → создать клиента", expected: "Диалог создания клиента, после сохранения клиент появляется в CRM" },
      { id: "D03", action: "Переключить месяц в виджетах", expected: "Цифры меняются в зависимости от периода" },
      { id: "D04", action: "Кликнуть по ссылке «Неотмеченные»", expected: "Переход на страницу с неотмеченными занятиями" },
    ],
  },
  {
    module: "2. Лиды",
    description: "/crm/leads — воронка продаж",
    cases: [
      { id: "L01", action: "Открыть Лиды → увидеть список по статусам воронки", expected: "Лиды из демо-данных разложены по статусам: новый, пробное записано, и т.д." },
      { id: "L02", action: "Нажать «+» → заполнить нового лида (имя, телефон, канал)", expected: "Лид появляется в воронке со статусом «новый»" },
      { id: "L03", action: "Кликнуть на лида → открыть карточку", expected: "Карточка с табами: обзор, абонементы, коммуникации, финансы" },
      { id: "L04", action: "Сменить статус воронки (новый → пробное записано → был на пробном)", expected: "Статус обновляется, лид перемещается в воронке" },
    ],
  },
  {
    module: "3. Клиенты",
    description: "/crm/clients — база клиентов",
    cases: [
      { id: "C01", action: "Открыть Клиенты → проверить список", expected: "Клиенты из демо-данных с сегментами (новый/стандарт/постоянный/VIP)" },
      { id: "C02", action: "Кликнуть на клиента → вкладка «Абонементы»", expected: "Список абонементов с балансами, статусами" },
      { id: "C03", action: "Добавить абонемент клиенту", expected: "Диалог с выбором направления, периода. Абонемент создаётся" },
      { id: "C04", action: "Вкладка «Финансы» → записать оплату", expected: "Диалог оплаты: сумма, метод, счёт. Баланс клиента увеличивается" },
      { id: "C05", action: "Вкладка «Подопечные» → добавить ребёнка", expected: "Диалог: имя, дата рождения. Подопечный появляется в списке" },
      { id: "C06", action: "Вкладка «Коммуникации»", expected: "История контактов: звонки, заметки, результаты обзвона" },
      { id: "C07", action: "Кнопка «Редактировать» на карточке", expected: "Диалог редактирования: имя, телефон, email. Данные сохраняются" },
    ],
  },
  {
    module: "4. Расписание",
    description: "/schedule — недельное расписание, группы, занятия",
    cases: [
      { id: "S01", action: "Открыть Расписание → выбрать филиал", expected: "Сетка с занятиями по дням и кабинетам" },
      { id: "S02", action: "Кликнуть на занятие → открыть lesson card", expected: "Карточка: группа, инструктор, список учеников, кнопки отметки" },
      { id: "S03", action: "Отметить посещение: присутствовал / пропуск / болезнь", expected: "Статус сохраняется, списание с абонемента (если countsAsRevenue)" },
      { id: "S04", action: "Заменить инструктора на занятии", expected: "Диалог замены, новый инструктор отображается" },
      { id: "S05", action: "Открыть Группы → создать новую группу", expected: "Диалог: название, направление, инструктор, кабинет, макс. учеников" },
      { id: "S06", action: "Сгенерировать расписание из шаблона на месяц", expected: "Занятия появляются в сетке расписания" },
      { id: "S07", action: "Массовая отмена занятий (праздник)", expected: "Выбираем дату → все занятия в этот день отменяются" },
      { id: "S08", action: "Зачислить ученика в группу", expected: "Диалог выбора клиента/подопечного → enrollment создан" },
      { id: "S09", action: "Перевод ученика между группами", expected: "Выбираем новую группу → enrollment перемещён" },
      { id: "S10", action: "Произв. календарь → добавить праздник", expected: "Праздник отображается в календаре, занятия учитывают" },
    ],
  },
  {
    module: "5. Абонементы и оплаты",
    description: "Полный цикл: абонемент → оплата → списание → возврат",
    cases: [
      { id: "P01", action: "Создать абонемент клиенту (календарный, на месяц)", expected: "Абонемент со статусом active, баланс = 0" },
      { id: "P02", action: "Записать оплату: наличные, 5000₽", expected: "Баланс абонемента +5000₽, payment создан" },
      { id: "P03", action: "Отметить присутствие на занятии", expected: "Баланс уменьшается на стоимость урока (chargeAmount)" },
      { id: "P04", action: "Оформить возврат", expected: "Диалог возврата: сумма, метод. Баланс уменьшается, refund создан" },
      { id: "P05", action: "Перенос баланса при создании нового абонемента", expected: "Подсказка о закрытых абонементах с остатком (SUB-12)" },
      { id: "P06", action: "Проверить lesson card: автосписание после отметки", expected: "chargeAmount рассчитан по тарифу направления" },
    ],
  },
  {
    module: "6. Финансы",
    description: "Расходы, ДДС, должники, касса",
    cases: [
      { id: "F01", action: "Оплаты → проверить сводку: наличные, безнал, итого", expected: "Суммы корректны, разбивка по методам оплаты" },
      { id: "F02", action: "Расходы → добавить расход (аренда, 50000₽)", expected: "Расход появляется в списке, итого обновляется" },
      { id: "F03", action: "Касса → проверить счета и балансы", expected: "Счета из демо-данных, балансы не отрицательные" },
      { id: "F04", action: "Касса → операция между счетами (инкассация)", expected: "Перевод: один счёт -, другой +. AccountOperation создан" },
      { id: "F05", action: "ДДС → проверить движение денег за месяц", expected: "Приход = оплаты, расход = расходы + ЗП, сальдо корректно" },
      { id: "F06", action: "Должники → проверить список", expected: "Клиенты с отрицательным балансом, суммы долга" },
      { id: "F07", action: "Экспорт в Excel (любой финансовый раздел)", expected: "Скачивается .xlsx с корректными данными" },
    ],
  },
  {
    module: "7. Зарплата",
    description: "/salary — расчёт и выплаты инструкторам",
    cases: [
      { id: "W01", action: "Открыть Зарплата → выбрать месяц", expected: "Список инструкторов с начислениями за отработанные занятия" },
      { id: "W02", action: "Кликнуть на инструктора → детализация", expected: "Разбивка: занятия, ученики, ставка, итого" },
      { id: "W03", action: "Нажать «Выплатить» → указать сумму и метод", expected: "Выплата создана, статус → оплачено" },
      { id: "W04", action: "Проверить 3 схемы ЗП (за ученика / за занятие / фикс + за ученика)", expected: "Суммы рассчитаны по схеме, указанной в карточке сотрудника" },
    ],
  },
  {
    module: "8. Задачи и обзвон",
    description: "/tasks, /crm/calls — управление задачами и кампании",
    cases: [
      { id: "T01", action: "Задачи → создать задачу (заголовок, исполнитель, срок)", expected: "Задача появляется в списке, статус «ожидает»" },
      { id: "T02", action: "Отметить задачу выполненной", expected: "Статус → выполнена, дата завершения заполнена" },
      { id: "T03", action: "Проверить автозадачи (должны быть из демо-данных)", expected: "Задачи по триггерам: непродление, долги, пропуски" },
      { id: "T04", action: "Обзвон → создать кампанию", expected: "Кампания с выборкой клиентов/лидов" },
      { id: "T05", action: "Обзвон → зафиксировать результат звонка", expected: "Результат сохранён, запись в коммуникациях клиента (CALL-04)" },
    ],
  },
  {
    module: "9. Отчёты",
    description: "/reports — 10+ отчётов по данным CRM",
    cases: [
      { id: "R01", action: "Открыть хаб отчётов → проверить список", expected: "Карточки отчётов с бейджами «Готов»" },
      { id: "R02", action: "Воронка продаж → открыть", expected: "Визуализация этапов: новый → пробное → оплата → клиент. Цифры из демо" },
      { id: "R03", action: "P&L (Финрез) → открыть", expected: "Выручка — Расходы — ЗП = Прибыль. Цифры сходятся с финансами" },
      { id: "R04", action: "Свободные места → открыть", expected: "Группы с заполненностью: записано / макс / %" },
      { id: "R05", action: "Средний чек → открыть", expected: "Средняя сумма оплаты за период" },
      { id: "R06", action: "Сводный по педагогам → открыть", expected: "Инструкторы: занятий, учеников, ЗП" },
      { id: "R07", action: "Отток / потенциальный отток", expected: "Клиенты с 3+ пропусками, непродлённые абонементы" },
    ],
  },
  {
    module: "10. Склад",
    description: "/stock — расходники, закупки, списание",
    cases: [
      { id: "I01", action: "Открыть Склад → проверить позиции", expected: "Демо-данные: Бумага, Маркеры, Антисептик и т.д." },
      { id: "I02", action: "Создать новую позицию (карандаши, штука, 15₽)", expected: "Позиция появляется в списке" },
      { id: "I03", action: "Закупка: 100 штук на филиал", expected: "StockBalance +100, движение в истории" },
      { id: "I04", action: "Склад → Кабинеты: перемещение в кабинет", expected: "Баланс филиала -, баланс кабинета +" },
      { id: "I05", action: "Склад → Кабинеты: списание из кабинета", expected: "Баланс кабинета уменьшается, движение зафиксировано" },
      { id: "I06", action: "Склад → Движения: проверить историю", expected: "Таблица: дата, тип, кол-во, кто" },
    ],
  },
  {
    module: "11. HR / Кандидаты",
    description: "/staff/candidates — воронка найма",
    cases: [
      { id: "H01", action: "Открыть Кандидаты → проверить список", expected: "Демо-кандидаты: Волкова, Зайцев, Кузнецова, Орлов" },
      { id: "H02", action: "Создать кандидата (имя, телефон, комментарий)", expected: "Кандидат появляется со статусом «Новый»" },
      { id: "H03", action: "Открыть карточку → сменить статус (Новый → Собеседование)", expected: "Статус обновляется, запись в истории встреч" },
      { id: "H04", action: "Добавить встречу (комментарий)", expected: "Запись появляется в таймлайне" },
      { id: "H05", action: "Принять кандидата (логин, пароль, роль, филиал)", expected: "Кандидат → сотрудник. Появляется в /staff" },
    ],
  },
  {
    module: "12. Настройки",
    description: "/settings — конфигурация организации",
    cases: [
      { id: "G01", action: "Организация → проверить параметры", expected: "Название, ИНН, настройки (оплата за прогул, лимит долга и т.д.)" },
      { id: "G02", action: "Филиалы → создать филиал + кабинет", expected: "Филиал и кабинет появляются в списках" },
      { id: "G03", action: "Направления → создать направление (цена за занятие)", expected: "Направление доступно при создании групп" },
      { id: "G04", action: "Справочники → каналы, причины пропусков, скидки", expected: "Списки редактируются, значения используются в формах" },
      { id: "G05", action: "Матрица прав → проверить 5 ролей", expected: "Чекбоксы прав для owner/manager/admin/instructor/readonly" },
      { id: "G06", action: "Шаблоны скидок → создать шаблон (% или ₽)", expected: "Шаблон доступен при добавлении абонемента" },
    ],
  },
  {
    module: "13. Сотрудники",
    description: "/staff — управление персоналом",
    cases: [
      { id: "E01", action: "Открыть Сотрудники → проверить список", expected: "Демо-сотрудники с ролями и филиалами" },
      { id: "E02", action: "Создать сотрудника (инструктор, логин/пароль)", expected: "Сотрудник появляется, можно войти под его логином" },
      { id: "E03", action: "Редактировать → сменить роль", expected: "Права обновляются согласно матрице" },
      { id: "E04", action: "Кнопка «Кандидаты» → переход на /staff/candidates", expected: "Переход на страницу кандидатов" },
    ],
  },
  {
    module: "14. Импорт и дубликаты",
    description: "/crm/import, /crm/duplicates",
    cases: [
      { id: "M01", action: "Импорт → загрузить CSV с клиентами", expected: "Маппинг колонок, предпросмотр, импорт. Клиенты появляются в CRM" },
      { id: "M02", action: "Дубликаты → проверить найденные совпадения", expected: "Пары похожих клиентов (имя + телефон)" },
    ],
  },
  {
    module: "15. Биллинг и ЛК",
    description: "/billing — подписка и счета",
    cases: [
      { id: "B01", action: "Открыть Подписка (/billing)", expected: "Текущий тариф, дата след. оплаты, список счетов" },
      { id: "B02", action: "Проверить бэк-офис /admin → дашборд", expected: "Управленческий дашборд: партнёры, MRR, активность" },
    ],
  },
  {
    module: "16. AI-ассистент",
    description: "Чат-виджет в правом нижнем углу (Премиум)",
    cases: [
      { id: "AI01", action: "Нажать пузырь с иконкой ✨ в правом нижнем углу", expected: "Открывается чат с подсказками вопросов" },
      { id: "AI02", action: "Спросить «Какая выручка за этот месяц?»", expected: "AI отвечает с конкретными цифрами из базы данных" },
      { id: "AI03", action: "Спросить «Кто из клиентов не продлил абонемент?»", expected: "AI перечисляет имена и суммы" },
    ],
  },
  {
    module: "17. Общее UX",
    description: "Навигация, адаптивность, ошибки",
    cases: [
      { id: "U01", action: "Проверить все пункты сайдбара — каждая ссылка открывается", expected: "Нет 404, все страницы загружаются" },
      { id: "U02", action: "Проверить на мобильном (или DevTools → 375px)", expected: "Сайдбар схлопывается, таблицы скроллятся, диалоги адаптивны" },
      { id: "U03", action: "Попробовать создать сущность с пустыми обязательными полями", expected: "Валидация: поля подсвечиваются, не даёт сохранить" },
      { id: "U04", action: "Открыть несуществующую страницу /crm/xyz", expected: "404 страница или редирект, не белый экран" },
      { id: "U05", action: "Выйти из системы → проверить что CRM недоступна", expected: "Редирект на /login, данные не утекают" },
    ],
  },
]

export default function TestingPage() {
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try {
      const saved = localStorage.getItem("crm-test-progress")
      if (saved) setChecked(JSON.parse(saved))
    } catch { /* ignore */ }
  }, [])

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = { ...prev, [id]: !prev[id] }
      try { localStorage.setItem("crm-test-progress", JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const total = testGroups.reduce((s, g) => s + g.cases.length, 0)
  const done = Object.values(checked).filter(Boolean).length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Тест-кейсы Умной CRM v1.5.4</h1>
        <p className="mt-2 text-muted-foreground">
          Полный цикл ручного тестирования — от входа до AI-ассистента.
          Отмечай пройденные кейсы, прогресс сохраняется в браузере.
        </p>
      </div>

      {/* Progress bar */}
      <div className="rounded-xl border bg-white p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Прогресс</span>
          <span className="text-sm text-muted-foreground">{done} / {total} ({pct}%)</span>
        </div>
        <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-indigo-600 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 text-sm">
        <a href="https://dev.umnayacrm.ru/dev" target="_blank" rel="noreferrer"
          className="rounded-lg border px-3 py-1.5 hover:bg-gray-50 transition-colors">
          Демо-вход (/dev)
        </a>
        <a href="https://dev.umnayacrm.ru/lp" target="_blank" rel="noreferrer"
          className="rounded-lg border px-3 py-1.5 hover:bg-gray-50 transition-colors">
          Лендинг (/lp)
        </a>
        <a href="https://dev.umnayacrm.ru/roadmap" target="_blank" rel="noreferrer"
          className="rounded-lg border px-3 py-1.5 hover:bg-gray-50 transition-colors">
          Roadmap
        </a>
        <a href="https://dev.umnayacrm.ru/changelog" target="_blank" rel="noreferrer"
          className="rounded-lg border px-3 py-1.5 hover:bg-gray-50 transition-colors">
          Changelog
        </a>
      </div>

      {/* Test groups */}
      {testGroups.map((group) => {
        const groupDone = group.cases.filter(c => checked[c.id]).length
        return (
          <div key={group.module} className="rounded-xl border bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b bg-gray-50 px-5 py-3">
              <div>
                <h2 className="font-semibold text-sm">{group.module}</h2>
                <p className="text-xs text-muted-foreground">{group.description}</p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap ml-4">
                {groupDone}/{group.cases.length}
              </span>
            </div>
            <div className="divide-y">
              {group.cases.map((tc) => (
                <label
                  key={tc.id}
                  className={`flex items-start gap-3 px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${checked[tc.id] ? "opacity-60" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={!!checked[tc.id]}
                    onChange={() => toggle(tc.id)}
                    className="mt-1 size-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-mono text-muted-foreground shrink-0">{tc.id}</span>
                      <span className={`text-sm ${checked[tc.id] ? "line-through" : ""}`}>
                        {tc.action}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 ml-8">
                      → {tc.expected}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )
      })}

      <div className="text-center text-sm text-muted-foreground pb-8">
        Нашёл баг? Запиши номер кейса + что пошло не так → передай в чат.
      </div>
    </div>
  )
}
