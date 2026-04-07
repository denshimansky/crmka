"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
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
import { Plus, Pencil, Trash2, Tag } from "lucide-react"

interface DiscountTemplate {
  id: string
  name: string
  type: "percent" | "fixed"
  value: number
  isActive: boolean
  description: string | null
}

const TYPE_LABELS: Record<string, string> = {
  percent: "Процент",
  fixed: "Фиксированная сумма",
}

function formatValue(type: string, value: number): string {
  if (type === "percent") return `${value}%`
  return new Intl.NumberFormat("ru-RU").format(value) + " ₽"
}

export default function DiscountTemplatesPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<DiscountTemplate[]>([])
  const [loading, setLoading] = useState(true)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTemplate, setEditTemplate] = useState<DiscountTemplate | null>(null)
  const [formName, setFormName] = useState("")
  const [formType, setFormType] = useState<"percent" | "fixed">("percent")
  const [formValue, setFormValue] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [formIsActive, setFormIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/discount-templates")
      if (res.ok) setTemplates(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadTemplates() }, [loadTemplates])

  function openCreate() {
    setEditTemplate(null)
    setFormName("")
    setFormType("percent")
    setFormValue("")
    setFormDescription("")
    setFormIsActive(true)
    setError(null)
    setDialogOpen(true)
  }

  function openEdit(t: DiscountTemplate) {
    setEditTemplate(t)
    setFormName(t.name)
    setFormType(t.type)
    setFormValue(String(t.value))
    setFormDescription(t.description || "")
    setFormIsActive(t.isActive)
    setError(null)
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!formName.trim()) {
      setError("Укажите название")
      return
    }
    if (!formValue || Number(formValue) <= 0) {
      setError("Укажите значение скидки")
      return
    }
    if (formType === "percent" && Number(formValue) > 100) {
      setError("Процент не может быть больше 100")
      return
    }

    setSaving(true)
    setError(null)

    try {
      const url = editTemplate
        ? `/api/discount-templates/${editTemplate.id}`
        : "/api/discount-templates"
      const method = editTemplate ? "PATCH" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          type: formType,
          value: Number(formValue),
          description: formDescription.trim() || null,
          isActive: formIsActive,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при сохранении")
        return
      }

      setDialogOpen(false)
      loadTemplates()
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить шаблон скидки?")) return
    try {
      await fetch(`/api/discount-templates/${id}`, { method: "DELETE" })
      loadTemplates()
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Шаблоны скидок</h1>
          <p className="text-sm text-muted-foreground">
            Готовые шаблоны для быстрого применения скидок к абонементам
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 size-4" />
          Шаблон
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Загрузка...
          </CardContent>
        </Card>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <Tag className="size-10 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">Нет шаблонов скидок</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Создайте шаблон для быстрого применения скидок
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
              <TableHead>Значение</TableHead>
              <TableHead>Описание</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map(t => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{TYPE_LABELS[t.type] || t.type}</Badge>
                </TableCell>
                <TableCell className="font-medium">
                  {formatValue(t.type, t.value)}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-[200px] truncate">
                  {t.description || "—"}
                </TableCell>
                <TableCell>
                  {t.isActive ? (
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
                      onClick={() => openEdit(t)}
                    >
                      <Pencil className="size-4 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => handleDelete(t.id)}
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editTemplate ? "Редактировать шаблон" : "Новый шаблон скидки"}
            </DialogTitle>
            <DialogDescription>
              Шаблон можно применять при создании абонемента
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
                placeholder="Скидка многодетным"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Тип</Label>
                <Select value={formType} onValueChange={(v) => { if (v) setFormType(v as "percent" | "fixed") }}>
                  <SelectTrigger className="w-full">
                    {TYPE_LABELS[formType]}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Процент</SelectItem>
                    <SelectItem value="fixed">Фиксированная сумма</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Значение</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max={formType === "percent" ? 100 : undefined}
                  placeholder={formType === "percent" ? "10" : "500"}
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Описание</Label>
              <Input
                placeholder="Для семей с 3+ детьми"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
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
              {saving ? "Сохранение..." : editTemplate ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
