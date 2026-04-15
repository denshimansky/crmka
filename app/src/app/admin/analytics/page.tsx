"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { BarChart3, Eye, Users, Building2, Clock } from "lucide-react"

interface AnalyticsData {
  days: number
  totalViews: number
  uniqueUsers: number
  uniqueOrgs: number
  topPages: { path: string; views: number }[]
  avgDuration: { path: string; avgSeconds: number; sessions: number }[]
  orgActivity: { tenantId: string; name: string; views: number }[]
  dailyViews: { date: string; count: number }[]
  dailyUsers: { date: string; count: number }[]
}

// Читаемое имя страницы
function pageName(path: string): string {
  const map: Record<string, string> = {
    "/": "Дашборд",
    "/crm/leads": "Лиды",
    "/crm/clients": "Клиенты",
    "/schedule/groups": "Группы",
    "/schedule/lessons": "Занятия",
    "/finance/payments": "Оплаты",
    "/finance/expenses": "Расходы",
    "/finance/salary": "Зарплата",
    "/finance/dds": "ДДС",
    "/reports": "Отчёты",
    "/tasks": "Задачи",
    "/settings": "Настройки",
  }
  return map[path] || path
}

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState("30")

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/analytics?days=${days}`)
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [days])

  if (loading) return <div className="p-6 text-muted-foreground">Загрузка...</div>
  if (!data) return <div className="p-6 text-destructive">Ошибка загрузки</div>

  // Максимум для полосок
  const maxViews = Math.max(...data.topPages.map((p) => p.views), 1)
  const maxOrgViews = Math.max(...data.orgActivity.map((o) => o.views), 1)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Аналитика использования</h1>
        <Select value={days} onValueChange={(v) => { if (v) setDays(v) }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 дней</SelectItem>
            <SelectItem value="14">14 дней</SelectItem>
            <SelectItem value="30">30 дней</SelectItem>
            <SelectItem value="90">90 дней</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Метрики */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Eye className="size-4" />Просмотры
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.totalViews.toLocaleString("ru")}</div>
            <div className="text-xs text-muted-foreground">за {data.days} дн.</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="size-4" />Пользователи
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.uniqueUsers}</div>
            <div className="text-xs text-muted-foreground">уникальных</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Building2 className="size-4" />Организации
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.uniqueOrgs}</div>
            <div className="text-xs text-muted-foreground">активных</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Топ страниц */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="size-4" />Популярные страницы
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.topPages.slice(0, 15).map((p) => (
                <div key={p.path} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate" title={p.path}>{pageName(p.path)}</span>
                    <span className="text-muted-foreground ml-2 tabular-nums">{p.views}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${(p.views / maxViews) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
              {data.topPages.length === 0 && (
                <p className="text-sm text-muted-foreground">Нет данных</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Время на странице */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="size-4" />Среднее время на странице
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Страница</TableHead>
                  <TableHead className="text-right">Ср. время</TableHead>
                  <TableHead className="text-right">Сессии</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.avgDuration.slice(0, 15).map((p) => (
                  <TableRow key={p.path}>
                    <TableCell className="truncate max-w-[200px]" title={p.path}>
                      {pageName(p.path)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.avgSeconds >= 60
                        ? `${Math.floor(p.avgSeconds / 60)}м ${p.avgSeconds % 60}с`
                        : `${p.avgSeconds}с`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.sessions}</TableCell>
                  </TableRow>
                ))}
                {data.avgDuration.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground">Нет данных</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Активность по организациям */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="size-4" />Активность по организациям
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {data.orgActivity.slice(0, 15).map((o) => (
              <div key={o.tenantId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate">{o.name}</span>
                  <span className="text-muted-foreground ml-2 tabular-nums">{o.views}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500"
                    style={{ width: `${(o.views / maxOrgViews) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {data.orgActivity.length === 0 && (
              <p className="text-sm text-muted-foreground">Нет данных</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Тренд по дням */}
      {data.dailyViews.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Просмотры по дням</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-32">
              {data.dailyViews.map((d) => {
                const maxDaily = Math.max(...data.dailyViews.map((v) => v.count), 1)
                const height = (d.count / maxDaily) * 100
                return (
                  <div
                    key={d.date}
                    className="flex-1 bg-blue-400 rounded-t hover:bg-blue-500 transition-colors relative group"
                    style={{ height: `${Math.max(height, 2)}%` }}
                    title={`${d.date}: ${d.count}`}
                  >
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block text-xs bg-popover border rounded px-1 py-0.5 whitespace-nowrap shadow">
                      {d.count}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>{data.dailyViews[0]?.date}</span>
              <span>{data.dailyViews[data.dailyViews.length - 1]?.date}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
