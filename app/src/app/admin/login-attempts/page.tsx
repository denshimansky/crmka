"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { ShieldAlert, ShieldCheck, ShieldX, Globe } from "lucide-react"

interface Attempt {
  id: string
  login: string
  success: boolean
  reason: string | null
  ip: string | null
  userAgent: string | null
  orgName: string | null
  employeeName: string | null
  createdAt: string
}

interface Data {
  stats: {
    total: number
    successful: number
    failed: number
    blocked: number
    uniqueIps: number
  }
  suspiciousIps: { ip: string; count: number }[]
  attempts: Attempt[]
}

const reasonLabels: Record<string, string> = {
  user_not_found: "Пользователь не найден",
  invalid_password: "Неверный пароль",
  blocked_brute_force: "Заблокирован (брутфорс)",
  ambiguous_login: "Неоднозначный логин",
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ru", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
}

export default function LoginAttemptsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState("7")

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/login-attempts?days=${days}`)
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [days])

  if (loading) return <div className="p-6 text-muted-foreground">Загрузка...</div>
  if (!data) return <div className="p-6 text-destructive">Ошибка загрузки</div>

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Лог входов</h1>
        <Select value={days} onValueChange={(v) => { if (v) setDays(v) }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Сегодня</SelectItem>
            <SelectItem value="7">7 дней</SelectItem>
            <SelectItem value="30">30 дней</SelectItem>
            <SelectItem value="90">90 дней</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Карточки */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ShieldCheck className="size-4 text-green-600" />Успешные
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{data.stats.successful}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ShieldX className="size-4 text-red-600" />Неудачные
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{data.stats.failed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ShieldAlert className="size-4 text-orange-600" />Заблокировано
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">{data.stats.blocked}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Globe className="size-4" />Уникальных IP
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.stats.uniqueIps}</div>
          </CardContent>
        </Card>
      </div>

      {/* Подозрительные IP */}
      {data.suspiciousIps.length > 0 && (
        <Card className="border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-orange-700 dark:text-orange-400">
              <ShieldAlert className="size-4" />Подозрительные IP (3+ неудачных попыток)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {data.suspiciousIps.map((s) => (
                <Badge key={s.ip} variant="destructive">
                  {s.ip} — {s.count} попыток
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Таблица */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Последние попытки входа</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Время</TableHead>
                <TableHead>Логин</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Организация</TableHead>
                <TableHead>Сотрудник</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Причина</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.attempts.slice(0, 100).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap tabular-nums text-xs">
                    {formatDate(a.createdAt)}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{a.login}</TableCell>
                  <TableCell>
                    {a.success ? (
                      <Badge variant="default" className="bg-green-600">OK</Badge>
                    ) : (
                      <Badge variant="destructive">Ошибка</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{a.orgName || "—"}</TableCell>
                  <TableCell className="text-sm">{a.employeeName || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{a.ip || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {a.reason ? reasonLabels[a.reason] || a.reason : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {data.attempts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">Нет данных</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
