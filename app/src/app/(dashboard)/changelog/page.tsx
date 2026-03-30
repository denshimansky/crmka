import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

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
        <h1 className="text-2xl font-bold">Changelog</h1>
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
