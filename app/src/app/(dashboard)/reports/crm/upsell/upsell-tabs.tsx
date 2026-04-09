"use client"

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ReportExport } from "@/components/report-export"
import Link from "next/link"

interface SingleDirectionRow {
  clientId: string
  clientName: string
  phone: string
  direction: string
  group: string
  amount: number
}

interface ExpiringRow {
  clientId: string
  clientName: string
  phone: string
  direction: string
  group: string
  amount: number
  endDate: string
}

interface ReducedActivityRow {
  clientId: string
  clientName: string
  phone: string
  prevCount: number
  currentCount: number
  lostDirections: string
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount)) + " \u20BD"
}

export function UpsellTabs({
  singleDirection,
  expiring,
  reducedActivity,
  monthName,
}: {
  singleDirection: SingleDirectionRow[]
  expiring: ExpiringRow[]
  reducedActivity: ReducedActivityRow[]
  monthName: string
}) {
  return (
    <Tabs defaultValue="single">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="single">
          Одно направление
          {singleDirection.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {singleDirection.length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="expiring">
          Скоро истекает
          {expiring.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {expiring.length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="reduced">
          Снизили активность
          {reducedActivity.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {reducedActivity.length}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      {/* Tab 1: Single direction */}
      <TabsContent value="single" className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Клиенты с одним активным направлением — потенциал для допродажи
          </p>
          <ReportExport
            title="Допродажи — Одно направление"
            filename={`upsell-single-${monthName}`}
            columns={[
              { header: "Клиент", key: "clientName", width: 25 },
              { header: "Телефон", key: "phone", width: 18 },
              { header: "Направление", key: "direction", width: 20 },
              { header: "Группа", key: "group", width: 20 },
              { header: "Сумма", key: "amount", width: 12 },
            ]}
            rows={singleDirection}
            sheetName="Одно направление"
            period={monthName}
          />
        </div>

        {singleDirection.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
              Нет клиентов с одним направлением
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Телефон</TableHead>
                  <TableHead>Направление</TableHead>
                  <TableHead>Группа</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {singleDirection.map((r) => (
                  <TableRow key={r.clientId}>
                    <TableCell>
                      <Link
                        href={`/crm/clients/${r.clientId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.clientName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.phone}</TableCell>
                    <TableCell>{r.direction}</TableCell>
                    <TableCell className="text-muted-foreground">{r.group}</TableCell>
                    <TableCell className="text-right">{formatMoney(r.amount)}</TableCell>
                    <TableCell>
                      <Link href={`/crm/clients/${r.clientId}`}>
                        <Button variant="outline" size="sm">
                          Карточка
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      {/* Tab 2: Expiring */}
      <TabsContent value="expiring" className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Абонементы, истекающие в ближайшие 2 недели — возможность продления
          </p>
          <ReportExport
            title="Допродажи — Скоро истекает"
            filename={`upsell-expiring-${monthName}`}
            columns={[
              { header: "Клиент", key: "clientName", width: 25 },
              { header: "Телефон", key: "phone", width: 18 },
              { header: "Направление", key: "direction", width: 20 },
              { header: "Группа", key: "group", width: 20 },
              { header: "Сумма", key: "amount", width: 12 },
              { header: "Дата окончания", key: "endDate", width: 15 },
            ]}
            rows={expiring}
            sheetName="Скоро истекает"
            period={monthName}
          />
        </div>

        {expiring.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
              Нет абонементов, истекающих в ближайшие 2 недели
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Телефон</TableHead>
                  <TableHead>Направление</TableHead>
                  <TableHead>Группа</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead>Истекает</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expiring.map((r, i) => (
                  <TableRow key={`${r.clientId}-${r.direction}-${i}`}>
                    <TableCell>
                      <Link
                        href={`/crm/clients/${r.clientId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.clientName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.phone}</TableCell>
                    <TableCell>{r.direction}</TableCell>
                    <TableCell className="text-muted-foreground">{r.group}</TableCell>
                    <TableCell className="text-right">{formatMoney(r.amount)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-orange-600">
                        {r.endDate}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Link href={`/crm/clients/${r.clientId}`}>
                        <Button variant="outline" size="sm">
                          Карточка
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      {/* Tab 3: Reduced activity */}
      <TabsContent value="reduced" className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Клиенты, сократившие количество направлений по сравнению с прошлым месяцем
          </p>
          <ReportExport
            title="Допродажи — Снизили активность"
            filename={`upsell-reduced-${monthName}`}
            columns={[
              { header: "Клиент", key: "clientName", width: 25 },
              { header: "Телефон", key: "phone", width: 18 },
              { header: "Было направлений", key: "prevCount", width: 18 },
              { header: "Стало направлений", key: "currentCount", width: 18 },
              { header: "Потерянные направления", key: "lostDirections", width: 30 },
            ]}
            rows={reducedActivity}
            sheetName="Снизили активность"
            period={monthName}
          />
        </div>

        {reducedActivity.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
              Нет клиентов, снизивших активность
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Телефон</TableHead>
                  <TableHead className="text-center">Было</TableHead>
                  <TableHead className="text-center">Стало</TableHead>
                  <TableHead>Потерянные направления</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reducedActivity.map((r) => (
                  <TableRow key={r.clientId}>
                    <TableCell>
                      <Link
                        href={`/crm/clients/${r.clientId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.clientName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.phone}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{r.prevCount}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={r.currentCount === 0 ? "destructive" : "secondary"}>
                        {r.currentCount}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.lostDirections}</TableCell>
                    <TableCell>
                      <Link href={`/crm/clients/${r.clientId}`}>
                        <Button variant="outline" size="sm">
                          Карточка
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>
    </Tabs>
  )
}
