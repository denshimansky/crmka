"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { ArrowLeft, Pencil, ExternalLink, Heading, Type, ImageIcon, ClipboardPaste, Video } from "lucide-react"
import { KbBlockEditor, type EditableBlock } from "@/components/kb/kb-block-editor"
import { KB_VARIANT_LABELS, type KbVariant } from "@/lib/kb-variant"

interface ArticleData {
  id: string
  title: string
  slug: string
  isPublished: boolean
  section: { id: string; title: string; slug: string; variant: KbVariant }
  blocks: EditableBlock[]
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

export default function AdminArticleEditorPage() {
  const params = useParams<{ articleId: string }>()
  const articleId = params.articleId

  const [article, setArticle] = useState<ArticleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [canEdit, setCanEdit] = useState(false)
  const [error, setError] = useState("")
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTitle, setRenameTitle] = useState("")
  const [videoOpen, setVideoOpen] = useState(false)
  const [videoUrl, setVideoUrl] = useState("")
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Обнуляем статью только на явный 404 (реально удалена). При транзиентной
  // ошибке (5xx/502 в момент автодеплоя или сетевой сбой) НЕ затираем текущую —
  // иначе после успешной правки редактор исчезал бы под «Статья не найдена».
  // refetch сам глотает ошибки (никогда не реджектится), поэтому безопасен и как
  // onChanged в KbBlockEditor (fire-and-forget), и в Promise.all инициализации.
  const refetch = async () => {
    try {
      const r = await fetch(`/api/admin/kb/articles/${articleId}`)
      if (r.ok) setArticle(await r.json())
      else if (r.status === 404) setArticle(null)
      else setError("Не удалось загрузить статью — сервер временно недоступен. Обновите страницу.")
    } catch {
      setError("Не удалось загрузить статью — проверьте соединение и обновите страницу.")
    }
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId])

  const run = async (fn: () => Promise<unknown>) => {
    setError("")
    try {
      await fn()
      await refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
    }
  }

  const addHeading = () => run(() => req("POST", "/api/admin/kb/blocks", { articleId, type: "heading", text: "Новый заголовок", level: 2 }))
  const addText = () => run(() => req("POST", "/api/admin/kb/blocks", { articleId, type: "text", text: "Новый текстовый блок." }))

  // Загрузка одной картинки новым блоком — общий путь для файла и буфера обмена.
  const uploadImage = async (file: File) => {
    const fd = new FormData()
    fd.append("file", file)
    const r = await fetch("/api/admin/kb/upload", { method: "POST", body: fd })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error || "Ошибка загрузки")
    await req("POST", "/api/admin/kb/blocks", { articleId, type: "image", mediaUrl: d.url })
  }

  const onImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    await run(() => uploadImage(f))
    if (fileRef.current) fileRef.current.value = ""
  }

  // Кнопка «Из буфера»: клик — это жест пользователя, поэтому Clipboard API
  // обычно отдаёт содержимое без запроса разрешения. Если API недоступен или
  // картинки в буфере нет — подсказываем про Ctrl+V (его ловит эффект ниже).
  const pasteImageFromClipboard = async () => {
    setError("")
    try {
      const items = navigator.clipboard?.read ? await navigator.clipboard.read() : []
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"))
        if (type) {
          const blob = await item.getType(type)
          await run(() => uploadImage(new File([blob], "clipboard", { type })))
          return
        }
      }
      setError("В буфере нет картинки. Скопируйте изображение и нажмите Ctrl+V прямо на странице.")
    } catch {
      setError("Браузер не дал прочитать буфер. Нажмите Ctrl+V прямо на странице, чтобы вставить картинку.")
    }
  }

  // Ctrl+V в любом месте редактора: если в буфере картинка — грузим её блоком.
  // Обычную вставку текста (в поля/блоки) не трогаем — реагируем только на файл-картинку.
  useEffect(() => {
    if (!canEdit || renameOpen || videoOpen) return
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const file = it.getAsFile()
          if (file) {
            e.preventDefault()
            void run(() => uploadImage(file))
            return
          }
        }
      }
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, articleId, renameOpen, videoOpen])

  const submitVideo = async () => {
    setSaving(true)
    setError("")
    try {
      await req("POST", "/api/admin/kb/blocks", { articleId, type: "video", mediaUrl: videoUrl.trim() })
      setVideoOpen(false)
      setVideoUrl("")
      await refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
    } finally {
      setSaving(false)
    }
  }

  const moveBlock = (id: string, dir: -1 | 1) =>
    run(async () => {
      if (!article) return
      const ids = article.blocks.map((b) => b.id)
      const idx = ids.indexOf(id)
      const target = idx + dir
      if (idx < 0 || target < 0 || target >= ids.length) return
      const next = [...ids]
      const [x] = next.splice(idx, 1)
      next.splice(target, 0, x)
      await req("POST", "/api/admin/kb/reorder", { entity: "block", ids: next })
    })

  const submitRename = async () => {
    const title = renameTitle.trim()
    if (!title) return
    setSaving(true)
    try {
      await req("PATCH", `/api/admin/kb/articles/${articleId}`, { title })
      setRenameOpen(false)
      await refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-muted-foreground">Загрузка...</div>
  // article=null при явном 404 → «не найдена»; при транзиентной ошибке загрузки
  // (5xx/сеть) article остаётся null, но задан error → показываем его, а не
  // вводящее в заблуждение «не найдена».
  if (!article) return (
    <div className="p-6 text-muted-foreground">
      {error || "Статья не найдена."}{" "}
      <Link href="/admin/knowledge" className="text-primary hover:underline">Назад</Link>
    </div>
  )

  // Предпросмотр — в бэк-офисе (admin-API отдаёт и черновики). Читалка
  // /knowledge/… показывает только опубликованное и требует сессию арендатора,
  // поэтому черновик там 404 (баг «предпросмотр кидает на 404»).
  const previewHref = `/admin/knowledge/${articleId}/preview`

  return (
    <div className="p-6">
      <Link href="/admin/knowledge" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> К списку разделов
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{article.title}</h1>
            {canEdit && (
              <Button variant="ghost" size="icon" className="size-8" onClick={() => { setRenameTitle(article.title); setRenameOpen(true) }} aria-label="Переименовать">
                <Pencil className="size-4" />
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Раздел: {article.section.title}
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px]">
              Вкладка: {KB_VARIANT_LABELS[article.section.variant]}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canEdit && (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={article.isPublished} onCheckedChange={(v) => run(() => req("PATCH", `/api/admin/kb/articles/${articleId}`, { isPublished: v }))} />
              {article.isPublished ? "Опубликована" : "Черновик"}
            </label>
          )}
          <Link href={previewHref} target="_blank">
            <Button variant="outline" size="sm"><ExternalLink className="mr-1.5 size-4" />Предпросмотр</Button>
          </Link>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {!canEdit && (
        <p className="mb-4 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Только просмотр. Редактирование — у ролей superadmin и development.
        </p>
      )}

      <div className="space-y-3">
        {article.blocks.length === 0 && (
          <div className="rounded-md border p-8 text-center text-muted-foreground">
            В статье пока нет блоков. {canEdit && "Добавьте первый блок ниже."}
          </div>
        )}
        {article.blocks.map((b, i) => (
          <KbBlockEditor
            key={b.id}
            block={b}
            canEdit={canEdit}
            isFirst={i === 0}
            isLast={i === article.blocks.length - 1}
            onChanged={refetch}
            onMove={(dir) => moveBlock(b.id, dir)}
          />
        ))}
      </div>

      {canEdit && (
        <>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={addHeading}><Heading className="mr-1.5 size-4" />Заголовок</Button>
            <Button variant="outline" size="sm" onClick={addText}><Type className="mr-1.5 size-4" />Текст</Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><ImageIcon className="mr-1.5 size-4" />Фото</Button>
            <Button variant="outline" size="sm" onClick={pasteImageFromClipboard}><ClipboardPaste className="mr-1.5 size-4" />Из буфера</Button>
            <Button variant="outline" size="sm" onClick={() => { setVideoUrl(""); setVideoOpen(true) }}><Video className="mr-1.5 size-4" />Видео</Button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={onImageFile} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Картинку можно вставить из буфера: кнопка «Из буфера» или Ctrl+V прямо на странице.</p>
        </>
      )}

      {/* Диалог переименования */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Переименовать статью</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Название</Label>
            <Input autoFocus value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitRename()} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>Отмена</Button>
            <Button onClick={submitRename} disabled={saving || !renameTitle.trim()}>{saving ? "..." : "Сохранить"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог добавления видео */}
      <Dialog open={videoOpen} onOpenChange={setVideoOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Добавить видео RuTube</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Ссылка на видео</Label>
            <Input autoFocus value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitVideo()} placeholder="https://rutube.ru/video/…" />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVideoOpen(false)}>Отмена</Button>
            <Button onClick={submitVideo} disabled={saving || !videoUrl.trim()}>{saving ? "..." : "Добавить"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
