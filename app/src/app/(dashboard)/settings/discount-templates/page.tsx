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
import { PageHelp } from "@/components/page-help"

interface DiscountTemplate {
  id: string
  name: string
  kind: "permanent" | "second_subscription" | "linked_sibling" | "linked_second_direction"
  systemKey: string | null
  valueType: "percent" | "fixed"
  value: number
  isActive: boolean
}

const TYPE_LABELS: Record<string, string> = {
  percent: "Процент",
  fixed: "Скидка за занятие",
}

const KIND_LABELS: Record<DiscountTemplate["kind"], string> = {
  permanent: "Постоянная",
  second_subscription: "Автоматическая",
  linked_sibling: "За 2-го ребёнка (устар.)",
  linked_second_direction: "За 2-е направление (устар.)",
}

function formatValue(valueType: string, value: number): string {
  if (valueType === "percent") return `${value}%`
  return "−" + new Intl.NumberFormat("ru-RU").format(value) + " ₽/занятие"
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
  // Скидки v2: при включении автоскидки — применить уже к ТЕКУЩЕМУ месяцу
  // (для свежезалитой базы). По умолчанию действует со следующего месяца.
  const [formApplyCurrentMonth, setFormApplyCurrentMonth] = useState(false)
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
    setFormType(t.valueType)
    setFormValue(String(t.value))
    setFormDescription("")
    setFormIsActive(t.isActive)
    setFormApplyCurrentMonth(false)
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

    // Скидки v2 §11.4: изменение размера НЕ пересчитывает уже выданные скидки —
    // предупреждаем явно.
    if (
      editTemplate &&
      (Number(formValue) !== Number(editTemplate.value) ||
        formType !== editTemplate.valueType)
    ) {
      const ok = confirm(
        "Размер скидки изменён. Уже выданные скидки НЕ пересчитаются — новое значение применится только к будущим применениям. Продолжить?",
      )
      if (!ok) return
    }

    setSaving(true)
    setError(null)

    try {
      const url = editTemplate
        ? `/api/discount-templates/${editTemplate.id}`
        : "/api/discount-templates"
      // У API на [id] есть PUT, не PATCH — раньше edit молча падал бы 405-кой.
      const method = editTemplate ? "PUT" : "POST"

      const isSystem = !!editTemplate?.systemKey
      const body: Record<string, unknown> = {
        valueType: formType,
        value: Number(formValue),
        isActive: formIsActive,
      }
      // Включение автоскидки: опционально применить уже к текущему месяцу.
      if (
        editTemplate?.kind === "second_subscription" &&
        formIsActive &&
        !editTemplate.isActive
      ) {
        body.applyFromCurrentMonth = formApplyCurrentMonth
      }
      // Системным шаблонам нельзя менять name, новым — kind не выбирается (только permanent).
      if (!isSystem) {
        body.name = formName.trim()
        if (!editTemplate) body.kind = "permanent"
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при сохранении")
        return
      }

      // Включение автоскидки: сервер пересчитал месяцы в зоне действия.
      const saved = await res.json().catch(() => ({}))
      if (typeof saved?._recalculatedClients === "number") {
        alert(
          formApplyCurrentMonth
            ? `Автоскидка включена с ТЕКУЩЕГО месяца. Уже выписанные абонементы текущего и будущих месяцев пересчитаны (клиентов: ${saved._recalculatedClients}).`
            : `Автоскидка включена. Действует на абонементы со следующего месяца; уже выписанные абонементы будущих месяцев пересчитаны (клиентов: ${saved._recalculatedClients}).`,
        )
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
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Шаблоны скидок</h1>
            <PageHelp pageKey="settings/discount-templates" />
          </div>
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
              <TableHead>Категория</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Значение</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map(t => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">
                  {t.name}
                  {t.systemKey && (
                    <Badge variant="secondary" className="ml-2">Системный</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{KIND_LABELS[t.kind]}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{TYPE_LABELS[t.valueType] || t.valueType}</Badge>
                </TableCell>
                <TableCell className="font-medium">
                  {formatValue(t.valueType, t.value)}
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
                    {!t.systemKey && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => handleDelete(t.id)}
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

      {/* Create/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
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
                disabled={!!editTemplate?.systemKey}
              />
              {editTemplate?.systemKey && (
                <p className="text-xs text-muted-foreground">
                  Системный шаблон — название изменить нельзя.
                </p>
              )}
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-4">
              <div className="space-y-2 min-w-0">
                <Label>Тип</Label>
                <Select value={formType} onValueChange={(v) => { if (v) setFormType(v as "percent" | "fixed") }}>
                  <SelectTrigger className="w-full min-w-0">
                    <span className="truncate">{TYPE_LABELS[formType]}</span>
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
                  placeholder={formType === "percent" ? "10" : "250"}
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value)}
                />
              </div>
            </div>

            {formType === "fixed" && (
              <p className="text-xs text-muted-foreground">
                Укажите <b>размер скидки за одно занятие</b>. Например, занятие
                стоит 350 ₽, скидка 100 ₽ — клиент платит 250 ₽ за занятие.
                Если скидка больше цены занятия — занятие становится бесплатным.
              </p>
            )}

            {editTemplate?.kind === "second_subscription" && (
              <p className="text-xs text-muted-foreground">
                Автоматическая скидка: при двух и более абонементах у родителя в
                одном месяце применяется ко всем, кроме самого дорогого. После
                включения действует на абонементы со следующего месяца; текущий
                месяц не пересчитывается.
              </p>
            )}

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

            {editTemplate?.kind === "second_subscription" &&
              formIsActive &&
              !editTemplate.isActive && (
                <div className="space-y-1 rounded-md border p-3">
                  <Label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formApplyCurrentMonth}
                      onChange={(e) => setFormApplyCurrentMonth(e.target.checked)}
                      className="size-4 rounded border"
                    />
                    <span>Применить уже к текущему месяцу</span>
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    По умолчанию скидка действует на абонементы со следующего
                    месяца. Отметьте, если база заполняется с нуля и скидка
                    нужна уже на абонементах текущего месяца — они будут
                    пересчитаны (с возвратом переплат на баланс).
                  </p>
                </div>
              )}
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
