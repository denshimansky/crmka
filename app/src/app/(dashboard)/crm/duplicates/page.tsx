"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { PageHelp } from "@/components/page-help"
import { Users, Merge, Loader2, CheckCircle2, Phone, Mail, MessageSquare } from "lucide-react"

interface DuplicateClient {
  id: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  email: string | null
  socialLink: string | null
  comment: string | null
  clientBalance: string
  funnelStatus: string
  clientStatus: string | null
  segment: string
  createdAt: string
  wards: { id: string; firstName: string; lastName: string | null }[]
  branch: { id: string; name: string } | null
  _count: {
    subscriptions: number
    payments: number
    enrollments: number
    attendances: number
  }
}

interface DuplicateGroup {
  phone: string
  clients: DuplicateClient[]
}

const SEGMENT_LABELS: Record<string, string> = {
  new_client: "Новый",
  regular: "Постоянный",
  loyal: "Лояльный",
  vip: "VIP",
}

const STATUS_LABELS: Record<string, string> = {
  active: "Активный",
  upsell: "Допродажа",
  churned: "Отчислен",
  returning: "Возвращается",
  archived: "Архив",
}

export default function DuplicatesPage() {
  const router = useRouter()
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [merging, setMerging] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<DuplicateGroup | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)

  useEffect(() => {
    fetchDuplicates()
  }, [])

  async function fetchDuplicates() {
    setLoading(true)
    try {
      const res = await fetch("/api/clients/duplicates")
      if (res.ok) {
        const data = await res.json()
        setGroups(data)
      }
    } finally {
      setLoading(false)
    }
  }

  function openMergeDialog(group: DuplicateGroup) {
    setSelectedGroup(group)
    setTargetId(null)
    setDialogOpen(true)
  }

  async function handleMerge() {
    if (!selectedGroup || !targetId) return
    setMerging(true)
    try {
      const sourceIds = selectedGroup.clients
        .filter((c) => c.id !== targetId)
        .map((c) => c.id)

      // Объединяем по одному
      for (const sourceId of sourceIds) {
        const res = await fetch("/api/clients/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId, targetId }),
        })
        if (!res.ok) {
          const err = await res.json()
          alert(`Ошибка: ${err.error}`)
          return
        }
      }

      setDialogOpen(false)
      router.push(`/crm/clients/${targetId}`)
    } finally {
      setMerging(false)
    }
  }

  function clientName(c: DuplicateClient) {
    return [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени"
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Дубликаты</h1>
          <PageHelp pageKey="crm/duplicates" />
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Дубликаты</h1>
        <PageHelp pageKey="crm/duplicates" />
        <Badge variant="secondary">{groups.length} групп</Badge>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <CheckCircle2 className="size-10 text-green-500" />
            <p className="text-lg font-medium">Дубликатов не найдено</p>
            <p className="text-sm text-muted-foreground">
              Все клиенты имеют уникальные номера телефонов
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <Card key={group.phone}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <div className="flex items-center gap-2">
                    <Phone className="size-4 text-muted-foreground" />
                    <span>{group.phone}</span>
                    <Badge variant="destructive">{group.clients.length} дублей</Badge>
                  </div>
                  <Button size="sm" onClick={() => openMergeDialog(group)}>
                    <Merge className="mr-1 size-4" />
                    Объединить
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {group.clients.map((client) => (
                    <div
                      key={client.id}
                      className="rounded-lg border p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{clientName(client)}</span>
                        {client.segment && (
                          <Badge variant="outline" className="text-xs">
                            {SEGMENT_LABELS[client.segment] || client.segment}
                          </Badge>
                        )}
                      </div>
                      {client.email && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Mail className="size-3" /> {client.email}
                        </div>
                      )}
                      {client.branch && (
                        <div className="text-sm text-muted-foreground">
                          Филиал: {client.branch.name}
                        </div>
                      )}
                      {client.clientStatus && (
                        <div className="text-sm">
                          Статус: {STATUS_LABELS[client.clientStatus] || client.clientStatus}
                        </div>
                      )}
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        <span>Абонементов: {client._count.subscriptions}</span>
                        <span>Оплат: {client._count.payments}</span>
                      </div>
                      {client.wards.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          <Users className="inline size-3 mr-1" />
                          {client.wards.map((w) => [w.firstName, w.lastName].filter(Boolean).join(" ")).join(", ")}
                        </div>
                      )}
                      {client.comment && (
                        <div className="flex items-start gap-1 text-xs text-muted-foreground">
                          <MessageSquare className="mt-0.5 size-3 shrink-0" />
                          <span className="line-clamp-2">{client.comment}</span>
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        Создан: {new Date(client.createdAt).toLocaleDateString("ru-RU")}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Диалог объединения */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Объединение клиентов</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Выберите <b>главного</b> клиента. Данные остальных будут перенесены к нему, а дубликаты удалены.
            </p>
            {selectedGroup?.clients.map((client) => (
              <button
                key={client.id}
                onClick={() => setTargetId(client.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  targetId === client.id
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{clientName(client)}</span>
                  {targetId === client.id && (
                    <Badge className="bg-primary text-primary-foreground">Главный</Badge>
                  )}
                </div>
                <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                  <span>Абонементов: {client._count.subscriptions}</span>
                  <span>Оплат: {client._count.payments}</span>
                  <span>Посещений: {client._count.attendances}</span>
                  <span>Баланс: {client.clientBalance} ₽</span>
                </div>
                {targetId === client.id && selectedGroup && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Будет перенесено от{" "}
                    {selectedGroup.clients.length - 1} клиент(ов):{" "}
                    абонементы, оплаты, посещения, подопечные, задачи
                  </div>
                )}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleMerge}
              disabled={!targetId || merging}
            >
              {merging && <Loader2 className="mr-1 size-4 animate-spin" />}
              Объединить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
