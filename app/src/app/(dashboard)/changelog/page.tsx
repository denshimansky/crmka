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
