import Link from "next/link"
import {
  Users, Calendar, CreditCard, BarChart3, Package, UserPlus,
  Shield, Smartphone, Zap, Check, ArrowRight, Sparkles, BotMessageSquare,
} from "lucide-react"

const features = [
  {
    icon: Users,
    title: "Клиенты и лиды",
    desc: "Воронка продаж, карточки клиентов, история коммуникаций, дубликаты, сегментация. Лид → клиент автоматически при первой оплате.",
  },
  {
    icon: Calendar,
    title: "Расписание и группы",
    desc: "Недельное расписание по кабинетам, генерация из шаблонов, отработки, замена инструктора, массовая отмена занятий.",
  },
  {
    icon: CreditCard,
    title: "Абонементы и оплаты",
    desc: "Автосписание занятий, возвраты, перенос баланса. Касса, несколько счетов, ЮKassa. Lesson card с отметкой посещений.",
  },
  {
    icon: BarChart3,
    title: "Финансы и отчёты",
    desc: "P&L по направлениям, ДДС, зарплата (3 схемы), должники, drill-down. 10+ отчётов с экспортом в Excel.",
  },
  {
    icon: Package,
    title: "Склад расходников",
    desc: "Закупка, перемещение в кабинеты, списание, амортизация. Баланс по филиалам и кабинетам.",
  },
  {
    icon: BotMessageSquare,
    title: "AI-ассистент",
    desc: "Спросите «какая выручка за месяц?» — и получите ответ с цифрами из вашей базы. Claude Haiku анализирует данные CRM в реальном времени.",
  },
]

const advantages = [
  { icon: Shield, text: "5 ролей с настройкой прав — от владельца до «только чтение»" },
  { icon: Smartphone, text: "PWA — работает как приложение на телефоне" },
  { icon: Zap, text: "Замена 1С за 15 минут — wizard онбординга и импорт из CSV" },
  { icon: BotMessageSquare, text: "AI-аналитик — задайте вопрос и получите цифры из своей базы" },
]

const faq = [
  {
    q: "Чем Умная CRM отличается от AmoCRM или Битрикс24?",
    a: "Умная CRM создана специально для детских центров и сферы услуг. Абонементы, расписание, lesson card, зарплата педагогам — всё из коробки, без интеграторов.",
  },
  {
    q: "Можно перенести данные из 1С?",
    a: "Да. Есть импорт клиентов из CSV/Excel с маппингом колонок. Мы поможем с миграцией.",
  },
  {
    q: "Сколько филиалов можно подключить?",
    a: "Тариф — за филиал. Количество пользователей и клиентов внутри филиала не ограничено.",
  },
  {
    q: "Есть мобильное приложение?",
    a: "Умная CRM работает как PWA — добавляете на рабочий стол телефона и используете как приложение. Все функции доступны.",
  },
  {
    q: "Что будет, если не оплатить вовремя?",
    a: "Грейс-период 1 рабочий день. Данные не удаляются — система блокируется до оплаты. Разблокировка мгновенная.",
  },
  {
    q: "Как работает AI-ассистент?",
    a: "Чат-виджет в правом нижнем углу. Задаёте вопрос — AI анализирует данные вашей организации (выручку, должников, загрузку групп) и отвечает с конкретными цифрами. До 50 запросов в день, доступен в тарифе Премиум.",
  },
]

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-indigo-50 to-white py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs font-medium text-indigo-700 mb-6">
              <Sparkles className="size-3" />
              v1.5 — 100% функционала MVP
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-gray-900 leading-tight">
              CRM для детских центров<br />
              <span className="text-indigo-600">без боли и 1С</span>
            </h1>
            <p className="mt-6 text-lg text-gray-600 max-w-2xl leading-relaxed">
              Расписание, абонементы, финансы, зарплата, отчёты — всё в одном месте.
              Для владельцев детских центров, студий и школ, которые устали от таблиц и 1С.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3" id="cta">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-6 py-3 text-base font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                Попробовать бесплатно
                <ArrowRight className="ml-2 size-4" />
              </Link>
              <a
                href="#features"
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-6 py-3 text-base font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Узнать больше
              </a>
            </div>
            <p className="mt-4 text-sm text-gray-500">
              5 000 ₽/мес за филиал. Без ограничений по пользователям и клиентам.
            </p>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y bg-white py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
            {[
              { num: "12", label: "модулей" },
              { num: "172", label: "требования PRD" },
              { num: "66", label: "страниц" },
              { num: "10+", label: "отчётов" },
            ].map((s) => (
              <div key={s.label}>
                <div className="text-3xl font-bold text-indigo-600">{s.num}</div>
                <div className="mt-1 text-sm text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900">Всё, что нужно центру</h2>
            <p className="mt-3 text-gray-600">12 модулей — от первого лида до закрытия периода</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border bg-white p-6 hover:shadow-md transition-shadow">
                <div className="flex size-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 mb-4">
                  <f.icon className="size-5" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Advantages */}
      <section className="bg-gray-50 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {advantages.map((a) => (
              <div key={a.text} className="flex items-start gap-3 rounded-lg bg-white p-5 border">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                  <a.icon className="size-4" />
                </div>
                <p className="text-sm text-gray-700 leading-relaxed">{a.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900">Простые тарифы</h2>
            <p className="mt-3 text-gray-600">Без скрытых платежей. Цена за филиал.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 max-w-3xl mx-auto">
            {/* Standard */}
            <div className="rounded-2xl border-2 border-gray-200 bg-white p-8">
              <h3 className="text-lg font-semibold text-gray-900">Стандарт</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-gray-900">5 000</span>
                <span className="text-gray-500">₽/мес</span>
              </div>
              <p className="mt-1 text-sm text-gray-500">за филиал</p>
              <ul className="mt-6 space-y-3">
                {[
                  "Все 12 модулей",
                  "Неограниченные пользователи",
                  "Неограниченные клиенты",
                  "Дашборд и отчёты",
                  "PWA (мобильная версия)",
                  "ЛК клиента",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-gray-700">
                    <Check className="size-4 text-green-500 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/login"
                className="mt-8 flex w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Начать
              </Link>
            </div>

            {/* Premium */}
            <div className="relative rounded-2xl border-2 border-indigo-600 bg-white p-8">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-0.5 text-xs font-medium text-white">
                Популярный
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Премиум</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-gray-900">7 000</span>
                <span className="text-gray-500">₽/мес</span>
              </div>
              <p className="mt-1 text-sm text-gray-500">за филиал</p>
              <ul className="mt-6 space-y-3">
                {[
                  "Всё из Стандарта",
                  "Интеграция ЮKassa / СБП",
                  "Онлайн-запись для клиентов",
                  "AI-ассистент (аналитика)",
                  "Приоритетная поддержка",
                  "Импорт из 1С с помощью",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-gray-700">
                    <Check className="size-4 text-indigo-500 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/login"
                className="mt-8 flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                Начать
              </Link>
            </div>
          </div>
          <p className="mt-8 text-center text-sm text-gray-500">
            Скидка 10% при оплате за 6 месяцев, 20% — за год
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="bg-gray-50 py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">Частые вопросы</h2>
          <div className="space-y-4">
            {faq.map((item) => (
              <details key={item.q} className="group rounded-xl border bg-white">
                <summary className="flex cursor-pointer items-center justify-between p-5 text-sm font-medium text-gray-900">
                  {item.q}
                  <span className="ml-4 text-gray-400 group-open:rotate-45 transition-transform text-lg">+</span>
                </summary>
                <div className="px-5 pb-5 text-sm text-gray-600 leading-relaxed">
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA bottom */}
      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 text-center">
          <h2 className="text-3xl font-bold text-gray-900">Готовы попробовать?</h2>
          <p className="mt-4 text-gray-600 max-w-xl mx-auto">
            Зарегистрируйтесь, пройдите 6-шаговый онбординг и начните работать за 15 минут.
          </p>
          <div className="mt-8">
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-8 py-3 text-base font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              Попробовать бесплатно
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
