"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Plus, Pencil, Trash2, MessageSquareText } from "lucide-react"
import { PageHelp } from "@/components/page-help"
import { TEMPLATE_PLACEHOLDERS } from "@/lib/ext/template-placeholders"

/**
 * Шаблоны ответов для панели в мессенджерах.
 *
 * Плейсхолдеры вставляются кликом прямо в текст: набирать «{ближайшее_занятие}»
 * руками — верный способ получить опечатку, которая всплывёт уже в сообщении
 * родителю (подстановка идёт на сервере, ошибочный ключ останется как есть).
 */

interface MessageTemplate {
  id: string
  title: string
  body: string
  sortOrder: number
}

export default function MessageTemplatesPage() {
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(true)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MessageTemplate | null>(null)
  const [formTitle, setFormTitle] = useState("")
  const [formBody, setFormBody] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/message-templates")
      if (res.ok) setTemplates(await res.json())
    } catch {
      /* сеть — покажем пустой список */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openCreate() {
    setEditing(null)
    setFormTitle("")
    setFormBody("")
    setError(null)
    setDialogOpen(true)
  }

  function openEdit(template: MessageTemplate) {
    setEditing(template)
    setFormTitle(template.title)
    setFormBody(template.body)
    setError(null)
    setDialogOpen(true)
  }

  /** Дописать плейсхолдер в конец текста — курсор в textarea мы не отслеживаем. */
  function addPlaceholder(key: string) {
    setFormBody((prev) => (prev ? `${prev}{${key}}` : `{${key}}`))
  }

  async function handleSave() {
    if (!formTitle.trim() || !formBody.trim()) {
      setError("Заполните название и текст шаблона")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(
        editing ? `/api/message-templates/${editing.id}` : "/api/message-templates",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: formTitle.trim(), body: formBody.trim() }),
        },
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при сохранении")
        return
      }
      setDialogOpen(false)
      load()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить шаблон?")) return
    try {
      await fetch(`/api/message-templates/${id}`, { method: "DELETE" })
      load()
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Шаблоны сообщений</h1>
            <PageHelp pageKey="settings/message-templates" />
          </div>
          <p className="text-sm text-muted-foreground">
            Готовые ответы для панели в мессенджерах: текст подставляется в поле ввода, отправляете вы
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
            <MessageSquareText className="size-10 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">Шаблонов пока нет</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Например: напоминание о занятии, просьба оплатить абонемент, ответ про расписание
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((template) => (
            <Card key={template.id}>
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="font-medium">{template.title}</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {template.body}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => openEdit(template)}
                  >
                    <Pencil className="size-4 text-muted-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => handleDelete(template.id)}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Редактировать шаблон" : "Новый шаблон"}</DialogTitle>
            <DialogDescription>
              Шаблон виден в панели расширения рядом с карточкой клиента
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
                placeholder="Напоминание о занятии"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Текст</Label>
              <Textarea
                rows={6}
                placeholder={"Здравствуйте, {родитель}! Напоминаем: у {ребёнок} занятие {ближайшее_занятие}. Ждём вас!"}
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-normal text-muted-foreground">
                Подставляются данными клиента — нажмите, чтобы добавить в текст
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_PLACEHOLDERS.map((placeholder) => (
                  <button
                    key={placeholder.key}
                    type="button"
                    title={placeholder.hint}
                    onClick={() => addPlaceholder(placeholder.key)}
                    className="rounded-full border px-2.5 py-1 text-xs hover:border-primary hover:text-primary"
                  >
                    {`{${placeholder.key}}`}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Если данных нет, подставится «—» — это видно до отправки.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Сохранение..." : editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
