"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  Plus, Pencil, Trash2, ChevronUp, ChevronDown, FolderPlus, FileText, Pencil as PencilIcon,
  ExternalLink, Copy, ClipboardPaste, X, ArrowLeftRight,
} from "lucide-react"
import { KB_VARIANT_LABELS, isKbVariant, type KbVariant } from "@/lib/kb-variant"

interface AdminArticle {
  id: string
  title: string
  slug: string
  sortOrder: number
  isPublished: boolean
}
interface AdminSection {
  id: string
  parentId: string | null
  variant: KbVariant
  title: string
  slug: string
  icon: string | null
  sortOrder: number
  isPublished: boolean
  articles: AdminArticle[]
}

type DialogState =
  | { mode: "create-top"; title: string }
  | { mode: "create-sub"; parentId: string; title: string }
  | { mode: "create-article"; sectionId: string; title: string }
  | { mode: "rename-section"; id: string; title: string }
  | { mode: "rename-article"; id: string; title: string }

const OTHER_VARIANT: Record<KbVariant, KbVariant> = { calendar: "package", package: "calendar" }

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

function reorderIds(ids: string[], id: string, dir: -1 | 1): string[] | null {
  const idx = ids.indexOf(id)
  const target = idx + dir
  if (idx < 0 || target < 0 || target >= ids.length) return null
  const next = [...ids]
  const [x] = next.splice(idx, 1)
  next.splice(target, 0, x)
  return next
}

export default function AdminKnowledgePage() {
  // useSearchParams требует Suspense-границу (иначе билд ругается и роут
  // деоптимизируется в клиентский рендер) — оборачиваем, как в login/page.tsx.
  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground">Загрузка...</div>}>
      <AdminKnowledgeContent />
    </Suspense>
  )
}

function AdminKnowledgeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sections, setSections] = useState<AdminSection[]>([])
  const [loading, setLoading] = useState(true)
  const [canEdit, setCanEdit] = useState(false)
  const [dlg, setDlg] = useState<DialogState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  // Активная вкладка живёт в URL (?tab=), а не в локальном состоянии: возврат из
  // редактора статьи (кнопка «К списку разделов» несёт ?tab=<variant> статьи)
  // и кнопка «назад» браузера открывают ту же вкладку, а не всегда «Календарный».
  const tabParam = searchParams.get("tab")
  const variant: KbVariant = isKbVariant(tabParam) ? tabParam : "calendar"
  const setVariant = (v: KbVariant) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", v)
    router.replace(`/admin/knowledge?${params.toString()}`, { scroll: false })
  }
  // Буфер копирования статьи: копируем в одной вкладке, вставляем в разделе
  // (в т.ч. другой вкладки). Держится до явной очистки — можно вставить в несколько разделов.
  const [clipboard, setClipboard] = useState<{ id: string; title: string } | null>(null)

  const refetch = () =>
    fetch("/api/admin/kb/sections")
      .then((r) => r.json())
      .then((data: AdminSection[]) => setSections(Array.isArray(data) ? data : []))

  useEffect(() => {
    Promise.all([
      refetch(),
      fetch("/api/admin/auth").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([, auth]) => {
        const role = auth?.admin?.role
        setCanEdit(role === "superadmin" || role === "development")
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Держим буфер в согласии с деревом: если статью-источник удалили (сама статья
  // или её раздел) — очищаем буфер (иначе «Вставить» упрётся в 404); если
  // переименовали — обновляем подпись в баннере.
  useEffect(() => {
    if (!clipboard) return
    const found = sections.flatMap((s) => s.articles).find((a) => a.id === clipboard.id)
    if (!found) setClipboard(null)
    else if (found.title !== clipboard.title) setClipboard({ id: found.id, title: found.title })
  }, [sections, clipboard])

  // Обёртка действия: показываем ошибку, перечитываем дерево.
  const run = async (fn: () => Promise<unknown>) => {
    setError("")
    try {
      await fn()
      await refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
    }
  }

  const submitDialog = async () => {
    if (!dlg) return
    const title = dlg.title.trim()
    if (!title) return
    setSaving(true)
    setError("")
    try {
      if (dlg.mode === "create-top") await req("POST", "/api/admin/kb/sections", { title, variant })
      else if (dlg.mode === "create-sub") await req("POST", "/api/admin/kb/sections", { title, parentId: dlg.parentId })
      else if (dlg.mode === "create-article") await req("POST", "/api/admin/kb/articles", { sectionId: dlg.sectionId, title })
      else if (dlg.mode === "rename-section") await req("PATCH", `/api/admin/kb/sections/${dlg.id}`, { title })
      else if (dlg.mode === "rename-article") await req("PATCH", `/api/admin/kb/articles/${dlg.id}`, { title })
      setDlg(null)
      await refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
    } finally {
      setSaving(false)
    }
  }

  // Разделы текущей вкладки. Подразделы фильтруем через parentId (variant у них
  // равен родителю, поэтому дополнительно по variant не режем).
  const tops = sections.filter((s) => !s.parentId && s.variant === variant)
  const childrenOf = (id: string) => sections.filter((s) => s.parentId === id)

  const moveSection = (siblings: AdminSection[], id: string, dir: -1 | 1) =>
    run(async () => {
      const next = reorderIds(siblings.map((s) => s.id), id, dir)
      if (next) await req("POST", "/api/admin/kb/reorder", { entity: "section", ids: next })
    })
  const moveArticle = (list: AdminArticle[], id: string, dir: -1 | 1) =>
    run(async () => {
      const next = reorderIds(list.map((a) => a.id), id, dir)
      if (next) await req("POST", "/api/admin/kb/reorder", { entity: "article", ids: next })
    })

  const pasteArticleInto = (sectionId: string) =>
    run(async () => {
      if (!clipboard) return
      await req("POST", "/api/admin/kb/articles/duplicate", {
        sourceArticleId: clipboard.id,
        targetSectionId: sectionId,
      })
    })

  const copySectionToOtherTab = (section: AdminSection) => {
    const target = OTHER_VARIANT[section.variant]
    if (!confirm(
      `Скопировать раздел «${section.title}» во вкладку «${KB_VARIANT_LABELS[target]}» со всеми подразделами и статьями?`,
    )) return
    run(async () => {
      await req("POST", "/api/admin/kb/sections/duplicate", { sectionId: section.id, targetVariant: target })
      setVariant(target) // показать результат в целевой вкладке
    })
  }

  // Пропсы заголовка раздела для текущего раздела (общие для верхних и подразделов).
  const sectionHeaderProps = (section: AdminSection, siblings: AdminSection[]) => ({
    section,
    siblings,
    canEdit,
    clipboardTitle: clipboard?.title ?? null,
    onPaste: () => pasteArticleInto(section.id),
    onTogglePublish: (v: boolean) => run(() => req("PATCH", `/api/admin/kb/sections/${section.id}`, { isPublished: v })),
    onMove: (dir: -1 | 1) => moveSection(siblings, section.id, dir),
    onAddSub: () => setDlg({ mode: "create-sub", parentId: section.id, title: "" }),
    onCopyToOtherTab: () => copySectionToOtherTab(section),
    onAddArticle: () => setDlg({ mode: "create-article", sectionId: section.id, title: "" }),
    onRename: () => setDlg({ mode: "rename-section", id: section.id, title: section.title }),
    onDelete: () =>
      confirm(`Удалить раздел «${section.title}» со всеми статьями и подразделами?`) &&
      run(() => req("DELETE", `/api/admin/kb/sections/${section.id}`)),
  })

  // Пропсы строки статьи.
  const articleRowProps = (article: AdminArticle, list: AdminArticle[]) => ({
    article,
    list,
    canEdit,
    copied: clipboard?.id === article.id,
    onCopy: () => setClipboard({ id: article.id, title: article.title }),
    onTogglePublish: (v: boolean) => run(() => req("PATCH", `/api/admin/kb/articles/${article.id}`, { isPublished: v })),
    onMove: (dir: -1 | 1) => moveArticle(list, article.id, dir),
    onRename: () => setDlg({ mode: "rename-article", id: article.id, title: article.title }),
    onDelete: () =>
      confirm(`Удалить статью «${article.title}»?`) &&
      run(() => req("DELETE", `/api/admin/kb/articles/${article.id}`)),
  })

  const dialogTitle = dlg
    ? {
        "create-top": "Новый раздел",
        "create-sub": "Новый подраздел",
        "create-article": "Новая статья",
        "rename-section": "Переименовать раздел",
        "rename-article": "Переименовать статью",
      }[dlg.mode]
    : ""

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">База знаний</h1>
          <p className="text-sm text-muted-foreground">
            Разделы, подразделы и статьи. Вкладка показывается партнёру по типу его абонемента:
            «Пакетный» — организациям с пакетным типом, «Календарный» — остальным.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/knowledge" target="_blank">
            <Button variant="outline" size="sm"><ExternalLink className="mr-1.5 size-4" />Открыть базу</Button>
          </Link>
          {canEdit && (
            <Button onClick={() => setDlg({ mode: "create-top", title: "" })}>
              <Plus className="mr-2 size-4" />Добавить раздел в «{KB_VARIANT_LABELS[variant]}»
            </Button>
          )}
        </div>
      </div>

      <Tabs value={variant} onValueChange={(v) => setVariant(v as KbVariant)} className="mb-4">
        <TabsList>
          <TabsTrigger value="calendar">Календарный</TabsTrigger>
          <TabsTrigger value="package">Пакетный</TabsTrigger>
        </TabsList>
      </Tabs>

      {clipboard && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <Copy className="size-4 text-primary" />
          <span>В буфере статья: <b>{clipboard.title}</b>. Откройте нужную вкладку и нажмите «Вставить статью» в разделе.</span>
          <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => setClipboard(null)}>
            <X className="mr-1 size-4" />Очистить
          </Button>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {!canEdit && !loading && (
        <p className="mb-4 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          У вашей роли доступ только на просмотр. Редактирование — у ролей superadmin и development.
        </p>
      )}

      {loading ? (
        <div className="text-muted-foreground">Загрузка...</div>
      ) : tops.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          В этой вкладке разделов пока нет.{" "}
          {canEdit && "Нажмите «Добавить раздел», чтобы начать, или скопируйте раздел из другой вкладки."}
        </div>
      ) : (
        <div className="space-y-4">
          {tops.map((top) => {
            const subs = childrenOf(top.id)
            return (
              <div key={top.id} className="rounded-lg border p-4">
                <SectionHeader {...sectionHeaderProps(top, tops)} isSub={false} />

                {top.articles.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {top.articles.map((a) => (
                      <ArticleRow key={a.id} {...articleRowProps(a, top.articles)} />
                    ))}
                  </div>
                )}

                {subs.map((sub) => (
                  <div key={sub.id} className="mt-3 rounded-md border border-dashed p-3">
                    <SectionHeader {...sectionHeaderProps(sub, subs)} isSub />
                    <div className="mt-2 space-y-1.5">
                      {sub.articles.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Статей нет</p>
                      ) : (
                        sub.articles.map((a) => <ArticleRow key={a.id} {...articleRowProps(a, sub.articles)} />)
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Название</Label>
            <Input
              autoFocus
              value={dlg?.title ?? ""}
              onChange={(e) => setDlg((d) => (d ? { ...d, title: e.target.value } : d))}
              onKeyDown={(e) => e.key === "Enter" && submitDialog()}
              placeholder="Введите название"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Отмена</Button>
            <Button onClick={submitDialog} disabled={saving || !dlg?.title.trim()}>
              {saving ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Компоненты вынесены на уровень модуля (не внутрь AdminKnowledgePage): иначе на
// каждый ре-рендер родителя (например, ввод символа в диалоге) их тип менялся бы
// и React перемонтировал всё дерево разделов/статей. Всё нужное — через пропсы.

function ArticleRow({
  article, list, canEdit, copied, onCopy, onTogglePublish, onMove, onRename, onDelete,
}: {
  article: AdminArticle
  list: AdminArticle[]
  canEdit: boolean
  copied: boolean
  onCopy: () => void
  onTogglePublish: (v: boolean) => void
  onMove: (dir: -1 | 1) => void
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <Link href={`/admin/knowledge/${article.id}`} className="flex-1 truncate text-sm hover:underline">
        {article.title}
      </Link>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">/{article.slug}</span>
      {canEdit && (
        <>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <Switch checked={article.isPublished} onCheckedChange={onTogglePublish} />
          </label>
          <IconBtn onClick={onCopy} label="Копировать статью (для вставки в другую вкладку/раздел)">
            <Copy className={`size-4 ${copied ? "text-primary" : ""}`} />
          </IconBtn>
          <IconBtn disabled={list[0]?.id === article.id} onClick={() => onMove(-1)} label="Выше"><ChevronUp className="size-4" /></IconBtn>
          <IconBtn disabled={list[list.length - 1]?.id === article.id} onClick={() => onMove(1)} label="Ниже"><ChevronDown className="size-4" /></IconBtn>
          <IconBtn onClick={onRename} label="Переименовать"><Pencil className="size-4" /></IconBtn>
          <IconBtn onClick={onDelete} label="Удалить"><Trash2 className="size-4 text-destructive" /></IconBtn>
        </>
      )}
      <Link href={`/admin/knowledge/${article.id}`}>
        <Button variant="ghost" size="sm">Открыть</Button>
      </Link>
    </div>
  )
}

function SectionHeader({
  section, siblings, isSub, canEdit, clipboardTitle,
  onPaste, onTogglePublish, onMove, onAddSub, onCopyToOtherTab, onAddArticle, onRename, onDelete,
}: {
  section: AdminSection
  siblings: AdminSection[]
  isSub: boolean
  canEdit: boolean
  clipboardTitle: string | null
  onPaste: () => void
  onTogglePublish: (v: boolean) => void
  onMove: (dir: -1 | 1) => void
  onAddSub: () => void
  onCopyToOtherTab: () => void
  onAddArticle: () => void
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={isSub ? "text-sm font-medium" : "font-semibold"}>{section.title}</span>
      <span className="hidden text-xs text-muted-foreground sm:inline">/{section.slug}</span>
      {!section.isPublished && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">черновик</span>}
      <div className="ml-auto flex items-center gap-1">
        {canEdit && clipboardTitle && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={onPaste}
            title={`Вставить статью «${clipboardTitle}» в этот раздел`}
          >
            <ClipboardPaste className="mr-1.5 size-4" />Вставить статью
          </Button>
        )}
        {canEdit && (
          <>
            <Switch checked={section.isPublished} onCheckedChange={onTogglePublish} />
            <IconBtn disabled={siblings[0]?.id === section.id} onClick={() => onMove(-1)} label="Выше"><ChevronUp className="size-4" /></IconBtn>
            <IconBtn disabled={siblings[siblings.length - 1]?.id === section.id} onClick={() => onMove(1)} label="Ниже"><ChevronDown className="size-4" /></IconBtn>
            {!isSub && (
              <>
                <IconBtn onClick={onAddSub} label="Добавить подраздел"><FolderPlus className="size-4" /></IconBtn>
                <IconBtn
                  onClick={onCopyToOtherTab}
                  label={`Скопировать раздел во вкладку «${KB_VARIANT_LABELS[OTHER_VARIANT[section.variant]]}»`}
                ><ArrowLeftRight className="size-4" /></IconBtn>
              </>
            )}
            <IconBtn onClick={onAddArticle} label="Добавить статью"><Plus className="size-4" /></IconBtn>
            <IconBtn onClick={onRename} label="Переименовать"><PencilIcon className="size-4" /></IconBtn>
            <IconBtn onClick={onDelete} label="Удалить"><Trash2 className="size-4 text-destructive" /></IconBtn>
          </>
        )}
      </div>
    </div>
  )
}

function IconBtn({ children, onClick, disabled, label }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled} onClick={onClick} aria-label={label} title={label}>
      {children}
    </Button>
  )
}
