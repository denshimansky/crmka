"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Plus, Pencil, Trash2, Sparkles } from "lucide-react"

interface AiFaqItem {
  id: string
  question: string
  answer: string
  category: string
  keywords: string | null
  isActive: boolean
  isCore: boolean
  source: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

const CATEGORIES = ["navigation", "logic", "data"] as const
type Category = (typeof CATEGORIES)[number]
const CATEGORY_LABELS: Record<string, string> = {
  navigation: "Навигация (где/как)",
  logic: "Логика и правила",
  data: "Данные организации",
}

interface DialogState {
  mode: "create" | "edit"
  id?: string
  question: string
  answer: string
  category: Category
  keywords: string
  isActive: boolean
  isCore: boolean
  sourceLogId?: string
}

async function req(method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || "Ошибка запроса")
  return data
}

export default function AdminAiFaqPage() {
  const [items, setItems] = useState<AiFaqItem[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dlg, setDlg] = useState<DialogState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const refetch = () =>
    fetch("/api/admin/ai-faq")
      .then((r) => r.json())
      .then((data) => {
        setItems(Array.isArray(data.items) ? data.items : [])
        setCanEdit(!!data.canEdit)
        return !!data.canEdit
      })

  // Первичная загрузка + автозаполнение формы при переходе «→ В базу знаний» со
  // страницы разбора. Данные передаются через sessionStorage (ключ ai-faq-prefill),
  // а не через URL — длинные кириллические ответы не влезают в query string.
  useEffect(() => {
    refetch()
      .then((editable) => {
        if (!editable) return
        let prefill: { q?: string; a?: string; log?: string } | null = null
        try {
          const raw = sessionStorage.getItem("ai-faq-prefill")
          if (raw) {
            prefill = JSON.parse(raw)
            sessionStorage.removeItem("ai-faq-prefill") // одноразово: не переоткрывать на F5
          }
        } catch {
          prefill = null
        }
        if (prefill?.q) {
          setDlg({
            mode: "create",
            question: prefill.q,
            answer: prefill.a || "",
            category: "navigation",
            keywords: "",
            isActive: true,
            isCore: false,
            sourceLogId: prefill.log || undefined,
          })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const run = async (fn: () => Promise<unknown>) => {
    setError("")
    try {
      await fn()
      await refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
    }
  }

  const openCreate = () =>
    setDlg({ mode: "create", question: "", answer: "", category: "navigation", keywords: "", isActive: true, isCore: false })

  const openEdit = (it: AiFaqItem) =>
    setDlg({
      mode: "edit",
      id: it.id,
      question: it.question,
      answer: it.answer,
      category: (CATEGORIES.includes(it.category as Category) ? it.category : "navigation") as Category,
      keywords: it.keywords || "",
      isActive: it.isActive,
      isCore: it.isCore,
    })

  const submit = async () => {
    if (!dlg) return
    const question = dlg.question.trim()
    const answer = dlg.answer.trim()
    if (!question || !answer) {
      setError("Заполните вопрос и ответ")
      return
    }
    setSaving(true)
    setError("")
    try {
      if (dlg.mode === "create") {
        await req("POST", "/api/admin/ai-faq", {
          question, answer, category: dlg.category,
          keywords: dlg.keywords.trim() || null,
          isActive: dlg.isActive,
          isCore: dlg.isCore,
          sourceLogId: dlg.sourceLogId || null,
        })
      } else {
        await req("PATCH", `/api/admin/ai-faq/${dlg.id}`, {
          question, answer, category: dlg.category,
          keywords: dlg.keywords.trim() || null,
          isActive: dlg.isActive,
          isCore: dlg.isCore,
        })
      }
      setDlg(null)
      await refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
    } finally {
      setSaving(false)
    }
  }

  const activeCount = items.filter((i) => i.isActive).length

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Sparkles className="size-6 text-orange-600" />
            ИИ: база знаний
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Ручные уточнения «вопрос → факт». Активные записи подмешиваются в ответы
            ИИ-помощника поверх встроенной справки — так он перестаёт врать по разобранным
            вопросам. Пополняется по разбору диалогов (раздел «ИИ: разбор»).
          </p>
        </div>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 size-4" />
            Добавить факт
          </Button>
        )}
      </div>

      {error && !dlg && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {!canEdit && !loading && (
        <p className="mb-4 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          У вашей роли доступ только на просмотр. Редактирование — у ролей superadmin и development.
        </p>
      )}

      {!loading && (
        <p className="mb-3 text-sm text-muted-foreground">
          Всего фактов: {items.length} · активных: {activeCount}
        </p>
      )}

      {loading ? (
        <div className="text-muted-foreground">Загрузка...</div>
      ) : items.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          Пока пусто. {canEdit && "Нажмите «Добавить факт» или перенесите его со страницы «ИИ: разбор»."}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div
              key={it.id}
              className={`rounded-lg border p-4 ${it.isActive ? "" : "opacity-60"}`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{CATEGORY_LABELS[it.category] || it.category}</Badge>
                {it.source === "review" && (
                  <Badge variant="outline" className="text-xs">из разбора</Badge>
                )}
                {it.isCore && (
                  <Badge className="text-xs" title="Идёт в каждый ответ, минуя отбор по теме вопроса">
                    ядро
                  </Badge>
                )}
                {!it.isActive && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">выключен</span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {canEdit && (
                    <>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        Активен
                        <Switch
                          checked={it.isActive}
                          onCheckedChange={(v) => run(() => req("PATCH", `/api/admin/ai-faq/${it.id}`, { isActive: v }))}
                        />
                      </label>
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(it)} title="Редактировать">
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="size-8"
                        onClick={() => confirm("Удалить факт из базы знаний ИИ?") && run(() => req("DELETE", `/api/admin/ai-faq/${it.id}`))}
                        title="Удалить"
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <p className="text-sm font-medium">{it.question}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{it.answer}</p>
              {it.keywords && (
                <p className="mt-2 text-xs text-muted-foreground">Ключевые слова: {it.keywords}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dlg?.mode === "edit" ? "Редактировать факт" : "Новый факт"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Вопрос / тема (как спрашивают)</Label>
              <Input
                autoFocus
                value={dlg?.question ?? ""}
                onChange={(e) => setDlg((d) => (d ? { ...d, question: e.target.value } : d))}
                placeholder="Например: Как продлить абонемент всем сразу?"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Ответ-факт (что должен знать ИИ)</Label>
              <Textarea
                rows={5}
                value={dlg?.answer ?? ""}
                onChange={(e) => setDlg((d) => (d ? { ...d, answer: e.target.value } : d))}
                placeholder="Короткий достоверный ответ человеческими словами, через названия пунктов меню."
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="min-w-[200px] flex-1 space-y-1.5">
                <Label>Категория</Label>
                <Select
                  value={dlg?.category ?? "navigation"}
                  onValueChange={(v) => v && setDlg((d) => (d ? { ...d, category: v as Category } : d))}
                >
                  <SelectTrigger className="w-full">
                    <span className="truncate">{CATEGORY_LABELS[dlg?.category ?? "navigation"]}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-4 pb-1.5">
                <label className="flex items-center gap-2">
                  <Switch
                    checked={dlg?.isActive ?? true}
                    onCheckedChange={(v) => setDlg((d) => (d ? { ...d, isActive: v } : d))}
                  />
                  <span className="text-sm text-muted-foreground">Активен</span>
                </label>
                <label className="flex items-center gap-2">
                  <Switch
                    checked={dlg?.isCore ?? false}
                    onCheckedChange={(v) => setDlg((d) => (d ? { ...d, isCore: v } : d))}
                  />
                  <span className="text-sm text-muted-foreground">Ядро</span>
                </label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Ключевые слова (опц., через запятую)</Label>
              <Input
                value={dlg?.keywords ?? ""}
                onChange={(e) => setDlg((d) => (d ? { ...d, keywords: e.target.value } : d))}
                placeholder="абонемент, продление, массово"
              />
              <p className="text-xs text-muted-foreground">
                В ответ попадают не все записи: «ядро» подмешивается всегда, остальные —
                когда слова вопроса совпали с вопросом, ключевыми словами или текстом ответа.
                Ключевые слова пишите так, как спрашивают люди («нет кнопки списать»), — по ним
                запись находится вернее всего. Ядром помечайте только общие правила: чем их
                больше, тем ближе промпт к прежнему раздутому виду.
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Отмена</Button>
            <Button onClick={submit} disabled={saving || !dlg?.question.trim() || !dlg?.answer.trim()}>
              {saving ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
