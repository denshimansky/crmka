import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { demoPayments, formatMoney } from "@/lib/demo-data"
import { Plus, Banknote, CreditCard, Globe, Wallet } from "lucide-react"

const summary = [
  { title: "Поступления", value: 892_400, icon: Wallet, color: "text-green-600", bg: "bg-green-50" },
  { title: "Наличные", value: 312_600, icon: Banknote, color: "text-emerald-600", bg: "bg-emerald-50" },
  { title: "Безнал", value: 284_200, icon: CreditCard, color: "text-blue-600", bg: "bg-blue-50" },
  { title: "Онлайн", value: 295_600, icon: Globe, color: "text-purple-600", bg: "bg-purple-50" },
]

export default function PaymentsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Оплаты</h1>
        <Button><Plus className="mr-2 size-4" />Оплата</Button>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Период:</span>
        <Badge variant="outline">1–25 марта 2026</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summary.map((s) => (
          <Card key={s.title}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className={`flex size-10 items-center justify-center rounded-lg ${s.bg}`}>
                <s.icon className={`size-5 ${s.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.title}</p>
                <p className="text-lg font-bold">{formatMoney(s.value)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Дата</TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead>Назначение</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
              <TableHead>Способ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {demoPayments.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="text-muted-foreground">{p.date}</TableCell>
                <TableCell className="font-medium">{p.client}</TableCell>
                <TableCell>{p.subscription}</TableCell>
                <TableCell className="text-right font-medium text-green-600">{p.amount > 0 ? formatMoney(p.amount) : "Бесплатно"}</TableCell>
                <TableCell><Badge variant="outline">{p.method}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
