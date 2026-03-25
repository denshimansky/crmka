import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { demoClients, formatMoney } from "@/lib/demo-data"
import { ArrowLeft, CreditCard, FileText, UserMinus } from "lucide-react"
import Link from "next/link"

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const client = demoClients.find((c) => c.id === id) || demoClients[0]

  const segmentColors: Record<string, string> = {
    VIP: "bg-purple-100 text-purple-800",
    "Постоянный": "bg-blue-100 text-blue-800",
    "Стандарт": "bg-gray-100 text-gray-800",
    "Новый": "bg-green-100 text-green-800",
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/crm/clients">
          <Button variant="ghost" size="icon"><ArrowLeft className="size-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{client.name}</h1>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${segmentColors[client.segment]}`}>{client.segment}</span>
            <Badge variant={client.status === "active" ? "default" : "secondary"}>
              {client.status === "active" ? "Активный" : client.status === "lead" ? "Лид" : "Выбывший"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{client.phone} · {client.email || "—"}</p>
        </div>
        <div className="flex gap-2">
          <Button><CreditCard className="mr-2 size-4" />Оплата</Button>
          <Button variant="outline"><FileText className="mr-2 size-4" />Абонемент</Button>
          <Button variant="destructive"><UserMinus className="mr-2 size-4" />Отчислить</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Баланс</CardTitle>
                <span className={`text-2xl font-bold ${client.balance > 0 ? "text-green-600" : client.balance < 0 ? "text-red-600" : ""}`}>
                  {formatMoney(client.balance)}
                </span>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Абонементы</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Направление</TableHead>
                    <TableHead>Период</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Оплачено</TableHead>
                    <TableHead className="text-right">Занятий</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Развивайка</TableCell>
                    <TableCell>Март 2026</TableCell>
                    <TableCell><Badge>Активен</Badge></TableCell>
                    <TableCell className="text-right">{formatMoney(4800)}</TableCell>
                    <TableCell className="text-right">6 из 12</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Английский</TableCell>
                    <TableCell>Март 2026</TableCell>
                    <TableCell><Badge>Активен</Badge></TableCell>
                    <TableCell className="text-right">{formatMoney(3600)}</TableCell>
                    <TableCell className="text-right">5 из 8</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Подопечные</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {client.children.map((child) => (
                <div key={child} className="flex items-center justify-between rounded-md border p-3">
                  <span className="font-medium">{child}</span>
                  <span className="text-sm text-muted-foreground">Развивайка, Английский</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Информация</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Ответственный</span><span>Петрова А.</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Канал</span><span>ВК реклама</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Первый визит</span><span>15.09.2024</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Абонементов</span><span>{client.subscriptions}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">LTV</span><span className="font-bold">{formatMoney(105_600)}</span></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
