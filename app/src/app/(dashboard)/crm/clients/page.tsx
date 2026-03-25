"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { demoClients, formatMoney } from "@/lib/demo-data"
import { Plus, Search } from "lucide-react"
import { useState } from "react"

const segmentColors: Record<string, string> = {
  VIP: "bg-purple-100 text-purple-800",
  "Постоянный": "bg-blue-100 text-blue-800",
  "Стандарт": "bg-gray-100 text-gray-800",
  "Новый": "bg-green-100 text-green-800",
}

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  active: { label: "Активный", variant: "default" },
  lead: { label: "Лид", variant: "secondary" },
  churned: { label: "Выбывший", variant: "destructive" },
}

export default function ClientsPage() {
  const [tab, setTab] = useState("all")
  const filtered = tab === "all" ? demoClients : demoClients.filter((c) => c.status === tab)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Клиенты</h1>
          <Badge variant="secondary">{demoClients.length}</Badge>
        </div>
        <Button><Plus className="mr-2 size-4" />Клиент</Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex gap-1">
          {[
            { key: "all", label: "Все" },
            { key: "active", label: "Активные" },
            { key: "lead", label: "Лиды" },
            { key: "churned", label: "Выбывшие" },
          ].map((t) => (
            <Button key={t.key} variant={tab === t.key ? "default" : "outline"} size="sm" onClick={() => setTab(t.key)}>{t.label}</Button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Поиск по имени, телефону..." className="pl-9" />
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ФИО</TableHead>
              <TableHead>Телефон</TableHead>
              <TableHead>Дети</TableHead>
              <TableHead>Сегмент</TableHead>
              <TableHead className="text-right">Баланс</TableHead>
              <TableHead>Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((client) => (
              <TableRow key={client.id} className="cursor-pointer hover:bg-muted/50">
                <TableCell>
                  <Link href={`/crm/clients/${client.id}`} className="font-medium hover:underline">{client.name}</Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{client.phone}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{client.children.join(", ")}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${segmentColors[client.segment] || ""}`}>{client.segment}</span>
                </TableCell>
                <TableCell className={`text-right font-medium ${client.balance > 0 ? "text-green-600" : client.balance < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                  {client.balance === 0 ? "—" : formatMoney(client.balance)}
                </TableCell>
                <TableCell>
                  <Badge variant={statusLabels[client.status]?.variant}>{statusLabels[client.status]?.label}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
