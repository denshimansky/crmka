import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatMoney } from "@/lib/demo-data"
import { Banknote, Building, CreditCard, Globe, ArrowDownToLine, ArrowUpFromLine, PiggyBank } from "lucide-react"

const accounts = [
  { title: "Касса наличных", value: 48_200, icon: Banknote, color: "text-green-600", bg: "bg-green-50" },
  { title: "Расчётный счёт", value: 412_600, icon: Building, color: "text-blue-600", bg: "bg-blue-50" },
  { title: "Эквайринг", value: 89_400, icon: CreditCard, color: "text-purple-600", bg: "bg-purple-50" },
  { title: "ЮKassa", value: 124_800, icon: Globe, color: "text-orange-600", bg: "bg-orange-50" },
]

const operations = [
  { time: "09:15", type: "Оплата", amount: 4800, account: "Касса", comment: "Иванова, развивайка", positive: true },
  { time: "11:30", type: "Оплата", amount: 3600, account: "Эквайринг", comment: "Петров, английский", positive: true },
  { time: "14:00", type: "Выемка", amount: 20_000, account: "Касса", comment: "Инкассация", positive: false },
  { time: "15:45", type: "Расход", amount: 3200, account: "Касса", comment: "Канцтовары", positive: false },
]

export default function CashPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Касса</h1>
        <div className="flex gap-2">
          <Button variant="outline"><ArrowUpFromLine className="mr-2 size-4" />Выемка</Button>
          <Button variant="outline"><PiggyBank className="mr-2 size-4" />Инкассация</Button>
          <Button><ArrowDownToLine className="mr-2 size-4" />Внести</Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {accounts.map((a) => (
          <Card key={a.title}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className={`flex size-10 items-center justify-center rounded-lg ${a.bg}`}>
                <a.icon className={`size-5 ${a.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{a.title}</p>
                <p className="text-lg font-bold">{formatMoney(a.value)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Операции за сегодня</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Время</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
                <TableHead>Счёт</TableHead>
                <TableHead>Комментарий</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operations.map((op, i) => (
                <TableRow key={i}>
                  <TableCell className="text-muted-foreground">{op.time}</TableCell>
                  <TableCell><Badge variant={op.positive ? "default" : "secondary"}>{op.type}</Badge></TableCell>
                  <TableCell className={`text-right font-medium ${op.positive ? "text-green-600" : "text-red-600"}`}>
                    {op.positive ? "+" : "−"}{formatMoney(op.amount)}
                  </TableCell>
                  <TableCell>{op.account}</TableCell>
                  <TableCell className="text-muted-foreground">{op.comment}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
