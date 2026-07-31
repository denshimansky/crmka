"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ChevronUp, ChevronDown, Trash2, Check, ImageUp, Loader2, Bold, Italic, Underline } from "lucide-react"
import { KbVideo } from "@/components/kb/kb-video"

export interface EditableBlock {
  id: string
  type: "heading" | "text" | "image" | "video"
  text: string | null
  level: number | null
  mediaUrl: string | null
  caption: string | null
}

const TYPE_LABEL: Record<EditableBlock["type"], string> = {
  heading: "Заголовок",
  text: "Текст",
  image: "Фото",
  video: "Видео",
}

async function patchBlock(id: string, body: unknown) {
  const r = await fetch(`/api/admin/kb/blocks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || "Ошибка сохранения")
  return d
}

export function KbBlockEditor({
  block,
  canEdit,
  isFirst,
  isLast,
  onChanged,
  onMove,
}: {
  block: EditableBlock
  canEdit: boolean
  isFirst: boolean
  isLast: boolean
  onChanged: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const [text, setText] = useState(block.text ?? "")
  const [level, setLevel] = useState(block.level ?? 2)
  const [caption, setCaption] = useState(block.caption ?? "")
  const [mediaUrl, setMediaUrl] = useState(block.mediaUrl ?? "")
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const flashSaved = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  // Обернуть выделенный фрагмент маркерами разметки (**жирный**, *курсив*,
  // __подчёркнутый__). Если ничего не выделено — вставляем «текст»-заглушку
  // и выделяем её, чтобы можно было сразу набрать поверх. Кнопки гасят
  // mousedown (preventDefault), поэтому фокус и выделение textarea сохраняются;
  // если же поле ни разу не фокусировали (selectionStart===0) — дописываем в конец.
  const wrapSelection = (marker: string) => {
    const ta = textRef.current
    if (!ta || !canEdit) return
    const focused = document.activeElement === ta
    const start = focused ? ta.selectionStart : text.length
    const end = focused ? ta.selectionEnd : text.length
    const selected = text.slice(start, end) || "текст"
    const next = text.slice(0, start) + marker + selected + marker + text.slice(end)
    setText(next)
    // React перерисует textarea позже — восстанавливаем выделение на следующем кадре.
    requestAnimationFrame(() => {
      ta.focus()
      const from = start + marker.length
      ta.setSelectionRange(from, from + selected.length)
    })
  }

  const save = async () => {
    setBusy(true)
    setErr("")
    try {
      if (block.type === "heading") await patchBlock(block.id, { text, level })
      else if (block.type === "text") await patchBlock(block.id, { text })
      else if (block.type === "image") await patchBlock(block.id, { caption })
      else if (block.type === "video") await patchBlock(block.id, { mediaUrl, caption })
      flashSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка")
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    if (!confirm("Удалить блок?")) return
    setBusy(true)
    try {
      await fetch(`/api/admin/kb/blocks/${block.id}`, { method: "DELETE" })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setBusy(true)
    setErr("")
    try {
      const fd = new FormData()
      fd.append("file", f)
      const r = await fetch("/api/admin/kb/upload", { method: "POST", body: fd })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || "Ошибка загрузки")
      await patchBlock(block.id, { mediaUrl: d.url })
      setMediaUrl(d.url)
      flashSaved()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Ошибка")
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
          {TYPE_LABEL[block.type]}
        </span>
        {saved && <span className="text-xs text-emerald-600">Сохранено</span>}
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" className="size-8" disabled={isFirst} onClick={() => onMove(-1)} aria-label="Выше">
            <ChevronUp className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-8" disabled={isLast} onClick={() => onMove(1)} aria-label="Ниже">
            <ChevronDown className="size-4" />
          </Button>
          {canEdit && (
            <Button type="button" variant="ghost" size="icon" className="size-8" disabled={busy} onClick={del} aria-label="Удалить">
              <Trash2 className="size-4 text-destructive" />
            </Button>
          )}
        </div>
      </div>

      {block.type === "heading" && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            disabled={!canEdit}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
          <Input value={text} onChange={(e) => setText(e.target.value)} disabled={!canEdit} placeholder="Текст заголовка" className="flex-1" />
        </div>
      )}

      {block.type === "text" && (
        <div className="space-y-2">
          {canEdit && (
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="icon" className="size-8" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection("**")} aria-label="Жирный" title="Жирный (**текст**)">
                <Bold className="size-4" />
              </Button>
              <Button type="button" variant="outline" size="icon" className="size-8" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection("*")} aria-label="Курсив" title="Курсив (*текст*)">
                <Italic className="size-4" />
              </Button>
              <Button type="button" variant="outline" size="icon" className="size-8" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection("__")} aria-label="Подчёркнутый" title="Подчёркнутый (__текст__)">
                <Underline className="size-4" />
              </Button>
            </div>
          )}
          <Textarea
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!canEdit}
            rows={4}
            placeholder="Текст. Поддерживается **жирный**, *курсив*, __подчёркнутый__, `код`. Enter — перенос строки, пустая строка — новый абзац."
          />
        </div>
      )}

      {block.type === "image" && (
        <div className="space-y-2">
          {mediaUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl} alt={caption || ""} className="max-h-64 rounded-md border" />
          ) : (
            <p className="text-sm text-muted-foreground">Фото не загружено</p>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={onFile} />
          {canEdit && (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                <ImageUp className="mr-1.5 size-4" />
                {mediaUrl ? "Заменить фото" : "Загрузить фото"}
              </Button>
            </div>
          )}
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} disabled={!canEdit} placeholder="Подпись (необязательно)" />
        </div>
      )}

      {block.type === "video" && (
        <div className="space-y-2">
          <Input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} disabled={!canEdit} placeholder="Ссылка RuTube (https://rutube.ru/video/…)" />
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} disabled={!canEdit} placeholder="Подпись (необязательно)" />
          {mediaUrl && <KbVideo url={mediaUrl} caption={caption} />}
        </div>
      )}

      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}

      {canEdit && (
        <div className="mt-2">
          <Button type="button" size="sm" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Check className="mr-1.5 size-4" />}
            Сохранить блок
          </Button>
        </div>
      )}
    </div>
  )
}
