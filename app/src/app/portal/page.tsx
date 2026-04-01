"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Calendar, CreditCard, Wallet, BookOpen, Clock, User,
} from "lucide-react"

interface PortalData {
  client: {
    firstName: string | null
    lastName: string | null
    phone: string | null
    email: string | null
    clientBalance: string
  }
  wards: { id: string; firstName: string; lastName: string | null; birthDate: string | null }[]
  subscriptions: {
    id: string; status: string; periodYear: number; periodMonth: number
    lessonPrice: string; totalLessons: number; totalAmount: string; finalAmount: string
    balance: string; chargedAmount: string; startDate: string; endDate: string | null
    direction: { name: string; color: string | null }
    group: { name: string }
    ward: { firstName: string; lastName: string | null } | null
  }[]
  subscriptionHistory: {
    id: string; status: string; periodYear: number; periodMonth: number
    finalAmount: string; direction: { name: string }; group: { name: string }
  }[]
  payments: {
    id: string; amount: string; type: string; method: string; date: string
    subscription: { direction: { name: string } } | null
  }[]
  schedule: {
    id: string; date: string; startTime: string; durationMinutes: number
    group: { name: string; direction: { name: string; color: string | null } }
    instructor: { firstName: string; lastName: string }
  }[]
}

const SUB_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Активен", variant: "default" },
  pending: { label: "Ожидание", variant: "secondary" },
  closed: { label: "Закрыт", variant: "outline" },
  withdrawn: { label: "Отчислен", variant: "destructive" },
}

const PAYMENT_METHOD: Record<string, string> = {
  cash: "Наличные",
  bank_transfer: "Безнал",
  acquiring: "Эквайринг",
  online_yukassa: "Онлайн (ЮKassa)",
  online_robokassa: "Онлайн (Робокасса)",
  sbp_qr: "СБП",
}

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]

export default function PortalPage() {
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/portal/data")
      .then((r) => {
        if (!r.ok) throw new Error("Не удалось загрузить данные")
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="py-8 text-center text-muted-foreground">Загрузка...</div>
  if (error || !data) return <div className="py-8 text-center text-destructive">{error}</div>

  const { client, wards, subscriptions, subscriptionHistory, payments, schedule } = data
  const balance = Number(client.clientBalance)

  return (
    <div className="space-y-6 py-4">
      {/* Баланс + Инфо */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Wallet className="size-4" />Баланс
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${balance < 0 ? "text-destructive" : ""}`}>
              {balance.toLocaleString("ru")} ₽
            </div>
            {balance < 0 && <p className="text-xs text-destructive mt-1">Есть задолженность</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BookOpen className="size-4" />Абонементы
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{subscriptions.length}</div>
            <p className="text-xs text-muted-foreground">активных</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="size-4" />Занятий на неделе
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{schedule.length}</div>
            <p className="text-xs text-muted-foreground">ближайших</p>
          </CardContent>
        </Card>
      </div>

      {/* Расписание */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Calendar className="size-4" />Расписание</CardTitle>
        </CardHeader>
        <CardContent>
          {schedule.length > 0 ? (
            <div className="space-y-2">
              {schedule.map((lesson) => {
                const d = new Date(lesson.date)
                const dayName = WEEKDAYS[d.getDay()]
                return (
                  <div key={lesson.id} className="flex items-center justify-between rounded-md border p-3">
                    <div className="flex items-center gap-3">
                      <div className="text-center w-16">
                        <div className="text-sm font-medium">{d.toLocaleDateString("ru", { day: "numeric", month: "short" })}</div>
                        <div className="text-xs text-muted-foreground">{dayName}</div>
                      </div>
                      <div>
                        <div className="font-medium text-sm">{lesson.group.direction.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {lesson.group.name} — {lesson.instructor.lastName} {lesson.instructor.firstName[0]}.
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="size-3 text-muted-foreground" />
                      {lesson.startTime} ({lesson.durationMinutes} мин)
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm py-4 text-center">Нет ближайших занятий</p>
          )}
        </CardContent>
      </Card>

      {/* Абонементы */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BookOpen className="size-4" />Активные абонементы</CardTitle>
        </CardHeader>
        <CardContent>
          {subscriptions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Направление</TableHead>
                  <TableHead>Группа</TableHead>
                  <TableHead>Подопечный</TableHead>
                  <TableHead>Период</TableHead>
                  <TableHead>Занятий</TableHead>
                  <TableHead>Сумма</TableHead>
                  <TableHead>Остаток</TableHead>
                  <TableHead>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((sub) => {
                  const ss = SUB_STATUS[sub.status] || { label: sub.status, variant: "outline" as const }
                  return (
                    <TableRow key={sub.id}>
                      <TableCell className="font-medium">{sub.direction.name}</TableCell>
                      <TableCell className="text-sm">{sub.group.name}</TableCell>
                      <TableCell className="text-sm">{sub.ward ? `${sub.ward.firstName} ${sub.ward.lastName || ""}` : "—"}</TableCell>
                      <TableCell className="text-sm">{String(sub.periodMonth).padStart(2, "0")}.{sub.periodYear}</TableCell>
                      <TableCell>{sub.totalLessons}</TableCell>
                      <TableCell>{Number(sub.finalAmount).toLocaleString("ru")} ₽</TableCell>
                      <TableCell className={Number(sub.balance) < 0 ? "text-destructive" : ""}>
                        {Number(sub.balance).toLocaleString("ru")} ₽
                      </TableCell>
                      <TableCell><Badge variant={ss.variant}>{ss.label}</Badge></TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm py-4 text-center">Нет активных абонементов</p>
          )}
        </CardContent>
      </Card>

      {/* Оплаты */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CreditCard className="size-4" />История оплат</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Направление</TableHead>
                  <TableHead>Способ</TableHead>
                  <TableHead>Сумма</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">{new Date(p.date).toLocaleDateString("ru")}</TableCell>
                    <TableCell className="text-sm">{p.subscription?.direction.name || "—"}</TableCell>
                    <TableCell className="text-sm">{PAYMENT_METHOD[p.method] || p.method}</TableCell>
                    <TableCell className={p.type === "refund" ? "text-destructive" : ""}>
                      {p.type === "refund" ? "−" : "+"}{Number(p.amount).toLocaleString("ru")} ₽
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm py-4 text-center">Нет оплат</p>
          )}
        </CardContent>
      </Card>

      {/* Подопечные */}
      {wards.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><User className="size-4" />Подопечные</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {wards.map((w) => (
                <div key={w.id} className="flex items-center justify-between rounded-md border p-3">
                  <span className="font-medium text-sm">{w.firstName} {w.lastName || ""}</span>
                  {w.birthDate && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(w.birthDate).toLocaleDateString("ru")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
