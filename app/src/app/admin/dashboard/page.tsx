"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Building2, TrendingUp, TrendingDown, AlertTriangle, Moon, UserPlus, CreditCard, FileWarning,
} from "lucide-react"

interface DashboardData {
  statusCounts: { total: number; active: number; grace: number; blocked: number }
  newThisMonth: number
  newLastMonth: number
  topByClients: { id: string; name: string; clients: number; employees: number; branches: number; status: string }[]
  sleeping: { id: string; name: string; clients: number }[]
  notOnboarded: { id: string; name: string; createdAt: string }[]
  mrr: number
  activeSubsCount: number
  unpaidAmount: number
  unpaidCount: number
  overdueCount: number
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Активен", variant: "default" },
  grace_period: { label: "Грейс", variant: "secondary" },
  blocked: { label: "Блок", variant: "destructive" },
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/admin/dashboard")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-6 text-muted-foreground">Загрузка...</div>
  if (!data) return <div className="p-6 text-destructive">Ошибка загрузки</div>

  const growthPercent = data.newLastMonth > 0
    ? Math.round(((data.newThisMonth - data.newLastMonth) / data.newLastMonth) * 100)
    : data.newThisMonth > 0 ? 100 : 0

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Дашборд</h1>

      {/* Карточки статистики */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Building2 className="size-4" />Партнёры
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.statusCounts.total}</div>
            <div className="flex gap-2 mt-1 text-xs">
              <span className="text-green-600">{data.statusCounts.active} акт.</span>
              {data.statusCounts.grace > 0 && <span className="text-amber-600">{data.statusCounts.grace} грейс</span>}
              {data.statusCounts.blocked > 0 && <span className="text-red-600">{data.statusCounts.blocked} блок</span>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <UserPlus className="size-4" />Новые за месяц
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.newThisMonth}</div>
            <div className="flex items-center gap-1 mt-1 text-xs">
              {growthPercent > 0 ? (
                <><TrendingUp className="size-3 text-green-600" /><span className="text-green-600">+{growthPercent}%</span></>
              ) : growthPercent < 0 ? (
                <><TrendingDown className="size-3 text-red-600" /><span className="text-red-600">{growthPercent}%</span></>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              <span className="text-muted-foreground">vs прошлый ({data.newLastMonth})</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CreditCard className="size-4" />MRR
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.mrr.toLocaleString("ru")} ₽</div>
            <div className="text-xs text-muted-foreground mt-1">
              {data.activeSubsCount} активных подписок
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileWarning className="size-4" />Неоплаченные счета
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.unpaidCount}</div>
            <div className="flex gap-2 mt-1 text-xs">
              <span className="text-muted-foreground">{data.unpaidAmount.toLocaleString("ru")} ₽</span>
              {data.overdueCount > 0 && <span className="text-red-600">{data.overdueCount} просрочено</span>}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Топ-10 по клиентам */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Топ-10 по количеству клиентов</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Партнёр</TableHead>
                  <TableHead className="text-right">Клиенты</TableHead>
                  <TableHead className="text-right">Сотр.</TableHead>
                  <TableHead className="text-right">Фил.</TableHead>
                  <TableHead>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topByClients.map((p) => {
                  const st = STATUS_BADGE[p.status] || { label: p.status, variant: "outline" as const }
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link href={`/admin/partners/${p.id}`} className="text-blue-600 hover:underline font-medium">
                          {p.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono">{p.clients}</TableCell>
                      <TableCell className="text-right font-mono">{p.employees}</TableCell>
                      <TableCell className="text-right font-mono">{p.branches}</TableCell>
                      <TableCell><Badge variant={st.variant} className="text-xs">{st.label}</Badge></TableCell>
                    </TableRow>
                  )
                })}
                {data.topByClients.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">Нет партнёров</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Спящие + не завершили онбординг */}
        <div className="space-y-6">
          {/* Спящие */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Moon className="size-4" />
                Спящие партнёры
                {data.sleeping.length > 0 && (
                  <Badge variant="secondary" className="text-xs">{data.sleeping.length}</Badge>
                )}
              </CardTitle>
              <p className="text-xs text-muted-foreground">Нет активности 7+ дней</p>
            </CardHeader>
            <CardContent>
              {data.sleeping.length === 0 ? (
                <p className="text-sm text-muted-foreground">Все активны :)</p>
              ) : (
                <div className="space-y-2">
                  {data.sleeping.slice(0, 10).map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-sm">
                      <Link href={`/admin/partners/${p.id}`} className="text-blue-600 hover:underline">
                        {p.name}
                      </Link>
                      <span className="text-muted-foreground">{p.clients} кл.</span>
                    </div>
                  ))}
                  {data.sleeping.length > 10 && (
                    <p className="text-xs text-muted-foreground">и ещё {data.sleeping.length - 10}...</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Не завершили онбординг */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="size-4" />
                Не завершили онбординг
                {data.notOnboarded.length > 0 && (
                  <Badge variant="destructive" className="text-xs">{data.notOnboarded.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.notOnboarded.length === 0 ? (
                <p className="text-sm text-muted-foreground">Все завершили</p>
              ) : (
                <div className="space-y-2">
                  {data.notOnboarded.slice(0, 10).map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-sm">
                      <Link href={`/admin/partners/${p.id}`} className="text-blue-600 hover:underline">
                        {p.name}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString("ru")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
