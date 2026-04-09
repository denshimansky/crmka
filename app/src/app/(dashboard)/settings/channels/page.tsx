"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Plus, Pencil, Trash2, Megaphone } from "lucide-react"
import { PageHelp } from "@/components/page-help"

interface LeadChannel {
  id: string
  name: string
  isSystem: boolean
  isActive: boolean
  sortOrder: number
}

export default function ChannelsPage() {
  const router = useRouter()
  const [channels, setChannels] = useState<LeadChannel[]>([])
  const [loading, setLoading] = useState(true)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editChannel, setEditChannel] = useState<LeadChannel | null>(null)
  const [formName, setFormName] = useState("")
  const [formIsActive, setFormIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadChannels = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/lead-channels")
      if (res.ok) setChannels(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadChannels() }, [loadChannels])

  function openCreate() {
    setEditChannel(null)
    setFormName("")
    setFormIsActive(true)
    setError(null)
    setDialogOpen(true)
  }

  function openEdit(ch: LeadChannel) {
    setEditChannel(ch)
    setFormName(ch.name)
    setFormIsActive(ch.isActive)
    setError(null)
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!formName.trim()) {
      setError("Укажите название канала")
      return
    }

    setSaving(true)
    setError(null)

    try {
      const url = editChannel
        ? `/api/lead-channels/${editChannel.id}`
        : "/api/lead-channels"
      const method = editChannel ? "PATCH" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          isActive: formIsActive,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при сохранении")
        return
      }

      setDialogOpen(false)
      loadChannels()
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Деактивировать канал?")) return
    try {
      await fetch(`/api/lead-channels/${id}`, { method: "DELETE" })
      loadChannels()
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Каналы привлечения</h1>
            <PageHelp pageKey="settings/channels" />
          </div>
          <p className="text-sm text-muted-foreground">
            Откуда приходят клиенты — для аналитики и маркетинга
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 size-4" />
          Канал
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Загрузка...
          </CardContent>
        </Card>
      ) : channels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <Megaphone className="size-10 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">Нет каналов привлечения</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Создайте каналы, чтобы отслеживать источники клиентов
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {channels.map((ch) => (
              <TableRow key={ch.id}>
                <TableCell className="font-medium">{ch.name}</TableCell>
                <TableCell>
                  {ch.isSystem ? (
                    <Badge variant="outline">Системный</Badge>
                  ) : (
                    <Badge variant="secondary">Пользовательский</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {ch.isActive ? (
                    <Badge variant="default">Активен</Badge>
                  ) : (
                    <Badge variant="secondary">Неактивен</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => openEdit(ch)}
                    >
                      <Pencil className="size-4 text-muted-foreground" />
                    </Button>
                    {!ch.isSystem && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => handleDelete(ch.id)}
                      >
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editChannel ? "Редактировать канал" : "Новый канал привлечения"}
            </DialogTitle>
            <DialogDescription>
              Каналы используются при создании лидов и клиентов
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label>Название</Label>
              <Input
                placeholder="Инстаграм"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                disabled={editChannel?.isSystem}
              />
            </div>

            <div className="flex items-center gap-3">
              <Label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="size-4 rounded border"
                />
                <span>Активен</span>
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Сохранение..." : editChannel ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
