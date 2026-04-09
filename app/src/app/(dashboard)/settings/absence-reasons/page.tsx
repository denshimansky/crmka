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
import { Plus, Pencil, Trash2, UserX } from "lucide-react"
import { PageHelp } from "@/components/page-help"

interface AbsenceReason {
  id: string
  name: string
  isSystem: boolean
  isActive: boolean
  sortOrder: number
}

export default function AbsenceReasonsPage() {
  const router = useRouter()
  const [reasons, setReasons] = useState<AbsenceReason[]>([])
  const [loading, setLoading] = useState(true)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editReason, setEditReason] = useState<AbsenceReason | null>(null)
  const [formName, setFormName] = useState("")
  const [formIsActive, setFormIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadReasons = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/absence-reasons")
      if (res.ok) setReasons(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadReasons() }, [loadReasons])

  function openCreate() {
    setEditReason(null)
    setFormName("")
    setFormIsActive(true)
    setError(null)
    setDialogOpen(true)
  }

  function openEdit(r: AbsenceReason) {
    setEditReason(r)
    setFormName(r.name)
    setFormIsActive(r.isActive)
    setError(null)
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!formName.trim()) {
      setError("Укажите название причины")
      return
    }

    setSaving(true)
    setError(null)

    try {
      const url = editReason
        ? `/api/absence-reasons/${editReason.id}`
        : "/api/absence-reasons"
      const method = editReason ? "PATCH" : "POST"

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
      loadReasons()
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Деактивировать причину?")) return
    try {
      await fetch(`/api/absence-reasons/${id}`, { method: "DELETE" })
      loadReasons()
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Причины пропусков</h1>
            <PageHelp pageKey="settings/absence-reasons" />
          </div>
          <p className="text-sm text-muted-foreground">
            Справочник причин отсутствия учеников на занятиях
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 size-4" />
          Причина
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Загрузка...
          </CardContent>
        </Card>
      ) : reasons.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <UserX className="size-10 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">Нет причин пропусков</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Создайте причины для учёта пропусков на занятиях
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
            {reasons.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>
                  {r.isSystem ? (
                    <Badge variant="outline">Системный</Badge>
                  ) : (
                    <Badge variant="secondary">Пользовательский</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {r.isActive ? (
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
                      onClick={() => openEdit(r)}
                    >
                      <Pencil className="size-4 text-muted-foreground" />
                    </Button>
                    {!r.isSystem && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => handleDelete(r.id)}
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
              {editReason ? "Редактировать причину" : "Новая причина пропуска"}
            </DialogTitle>
            <DialogDescription>
              Причина выбирается при отметке прогула в карточке занятия
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
                placeholder="Болезнь"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                disabled={editReason?.isSystem}
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
              {saving ? "Сохранение..." : editReason ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
