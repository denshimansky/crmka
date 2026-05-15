"use client"

/* eslint-disable @next/next/no-img-element */
// next/image не подходит — рендерим data URL из буфера пользователя, без known-dimensions

import { useState, useEffect, useRef, useCallback } from "react"

interface BugReport {
  id: number
  text: string
  screenshot: string | null  // data URL
  createdAt: string
  status: "open" | "fixed"
}

const STORAGE_KEY = "crm-bug-reports"

export default function BugsPage() {
  const [bugs, setBugs] = useState<BugReport[]>([])
  const [draftText, setDraftText] = useState("")
  const [draftScreenshot, setDraftScreenshot] = useState<string | null>(null)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setBugs(JSON.parse(saved))
    } catch { /* ignore */ }
  }, [])

  const persist = (next: BugReport[]) => {
    setBugs(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      setError(null)
    } catch (e) {
      setError("Браузер не смог сохранить — переполнено хранилище. Удали старые баги или скрины.")
      console.error("localStorage quota exceeded", e)
    }
  }

  // Глобальный paste handler — если что-то скопировано (картинка) и фокус не в textarea,
  // вставляем как скрин
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile()
        if (!blob) continue
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result === "string") {
            setDraftScreenshot(reader.result)
          }
        }
        reader.readAsDataURL(blob)
        e.preventDefault()
        return
      }
    }
  }, [])

  useEffect(() => {
    window.addEventListener("paste", handlePaste)
    return () => window.removeEventListener("paste", handlePaste)
  }, [handlePaste])

  const addBug = () => {
    if (!draftText.trim() && !draftScreenshot) {
      setError("Опиши баг или вставь скриншот")
      return
    }
    const nextId = bugs.reduce((m, b) => Math.max(m, b.id), 0) + 1
    const next: BugReport[] = [
      ...bugs,
      {
        id: nextId,
        text: draftText.trim(),
        screenshot: draftScreenshot,
        createdAt: new Date().toISOString(),
        status: "open",
      },
    ]
    persist(next)
    setDraftText("")
    setDraftScreenshot(null)
    textareaRef.current?.focus()
  }

  const deleteBug = (id: number) => {
    if (!confirm(`Удалить баг #${id}?`)) return
    persist(bugs.filter((b) => b.id !== id))
  }

  const toggleStatus = (id: number) => {
    persist(bugs.map((b) => (b.id === id ? { ...b, status: b.status === "open" ? "fixed" : "open" } : b)))
  }

  const copyText = async (bug: BugReport) => {
    const payload = `Баг #${bug.id} (${new Date(bug.createdAt).toLocaleString("ru-RU")})\n\n${bug.text}`
    try {
      await navigator.clipboard.writeText(payload)
      setCopiedId(bug.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      setError("Не удалось скопировать — браузер заблокировал clipboard API")
    }
  }

  const copyImageToClipboard = async (dataUrl: string) => {
    try {
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      // Если PNG — пишем напрямую. Если другой формат — пытаемся через ClipboardItem.
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      setError(null)
      alert("Скриншот скопирован в буфер. Жми Ctrl+V в чат.")
    } catch (e) {
      console.error(e)
      setError("Не удалось скопировать картинку. Открой её в новой вкладке и копируй вручную (правой кнопкой → копировать изображение).")
    }
  }

  const openImageInNewTab = (dataUrl: string) => {
    const w = window.open()
    if (!w) return
    w.document.write(`<title>Скриншот</title><body style="margin:0;background:#222;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${dataUrl}" style="max-width:100%;max-height:100vh"></body>`)
    w.document.close()
  }

  const exportAll = () => {
    const text = bugs.map((b) =>
      `Баг #${b.id} [${b.status}] (${new Date(b.createdAt).toLocaleString("ru-RU")})\n${b.text}${b.screenshot ? "\n[скриншот вложен]" : ""}`
    ).join("\n\n---\n\n")
    navigator.clipboard.writeText(text)
    alert(`Скопировано ${bugs.length} багов как текст. Скрины надо копировать отдельно через кнопку «Скрин в буфер».`)
  }

  const clearAll = () => {
    if (!confirm(`Удалить ВСЕ ${bugs.length} багов и скриншоты? Восстановить нельзя.`)) return
    persist([])
  }

  const openCount = bugs.filter((b) => b.status === "open").length
  const fixedCount = bugs.filter((b) => b.status === "fixed").length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Баг-трекер</h1>
        <p className="mt-2 text-muted-foreground">
          Записывай баги в процессе тестирования. Скриншот вставляется через Ctrl+V в любом месте страницы.
          Прогресс сохраняется в браузере (localStorage), на сервер ничего не уходит.
        </p>
      </div>

      {/* Сводка */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs text-muted-foreground">Всего</div>
          <div className="text-2xl font-bold">{bugs.length}</div>
        </div>
        <div className="rounded-xl border bg-rose-50 p-4">
          <div className="text-xs text-rose-700">Открытые</div>
          <div className="text-2xl font-bold text-rose-700">{openCount}</div>
        </div>
        <div className="rounded-xl border bg-emerald-50 p-4">
          <div className="text-xs text-emerald-700">Починены</div>
          <div className="text-2xl font-bold text-emerald-700">{fixedCount}</div>
        </div>
      </div>

      {/* Форма */}
      <div className="rounded-xl border bg-white p-5 space-y-3">
        <h2 className="font-semibold text-sm">Новый баг</h2>
        <textarea
          ref={textareaRef}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          placeholder="Что не работает? Где? Как воспроизвести? (Ctrl+V — вставить скриншот в любое место страницы)"
          className="w-full min-h-[120px] rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />

        {draftScreenshot ? (
          <div className="relative inline-block">
            <img src={draftScreenshot} alt="Превью" className="max-h-48 rounded-lg border" />
            <button
              onClick={() => setDraftScreenshot(null)}
              className="absolute -top-2 -right-2 size-6 rounded-full bg-rose-600 text-white text-xs hover:bg-rose-700"
              title="Убрать скриншот"
            >
              ×
            </button>
          </div>
        ) : (
          <div className="rounded-lg border-2 border-dashed border-gray-300 px-4 py-6 text-center text-sm text-muted-foreground">
            Скриншот не вставлен. Нажми <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs">Ctrl</kbd>+<kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs">V</kbd> для вставки из буфера.
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            onClick={addBug}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Добавить баг
          </button>
          {bugs.length > 0 && (
            <div className="flex gap-2 text-xs">
              <button
                onClick={exportAll}
                className="rounded border px-3 py-1.5 hover:bg-gray-50"
              >
                Экспорт всех (текстом)
              </button>
              <button
                onClick={clearAll}
                className="rounded border border-rose-200 px-3 py-1.5 text-rose-700 hover:bg-rose-50"
              >
                Очистить всё
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Список */}
      {bugs.length === 0 ? (
        <div className="rounded-xl border bg-gray-50 p-8 text-center text-sm text-muted-foreground">
          Пока пусто. Первый баг добавится наверх в форме выше.
        </div>
      ) : (
        <div className="space-y-3">
          {[...bugs].reverse().map((bug) => (
            <div
              key={bug.id}
              className={`rounded-xl border bg-white p-4 ${bug.status === "fixed" ? "opacity-60" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm font-bold">#{bug.id}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(bug.createdAt).toLocaleString("ru-RU")}
                    </span>
                    {bug.status === "fixed" && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                        Починен
                      </span>
                    )}
                  </div>
                  {bug.text && (
                    <p className={`text-sm whitespace-pre-wrap ${bug.status === "fixed" ? "line-through" : ""}`}>
                      {bug.text}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1 shrink-0 text-xs">
                  <button
                    onClick={() => copyText(bug)}
                    className="rounded border px-2 py-1 hover:bg-gray-50"
                  >
                    {copiedId === bug.id ? "✓ Скопировано" : "Текст в буфер"}
                  </button>
                  <button
                    onClick={() => toggleStatus(bug.id)}
                    className="rounded border px-2 py-1 hover:bg-gray-50"
                  >
                    {bug.status === "open" ? "Отметить починенным" : "Вернуть открытым"}
                  </button>
                  <button
                    onClick={() => deleteBug(bug.id)}
                    className="rounded border border-rose-200 px-2 py-1 text-rose-700 hover:bg-rose-50"
                  >
                    Удалить
                  </button>
                </div>
              </div>

              {bug.screenshot && (
                <div className="mt-3 flex items-start gap-3">
                  <img
                    src={bug.screenshot}
                    alt={`Скриншот бага #${bug.id}`}
                    onClick={() => setLightboxImage(bug.screenshot)}
                    className="max-h-32 rounded-lg border cursor-pointer hover:opacity-80"
                    title="Кликни, чтобы открыть в полном размере"
                  />
                  <div className="flex flex-col gap-1 text-xs">
                    <button
                      onClick={() => setLightboxImage(bug.screenshot)}
                      className="rounded border px-2 py-1 hover:bg-gray-50"
                    >
                      Открыть
                    </button>
                    <button
                      onClick={() => copyImageToClipboard(bug.screenshot!)}
                      className="rounded border px-2 py-1 hover:bg-gray-50"
                    >
                      Скрин в буфер
                    </button>
                    <button
                      onClick={() => openImageInNewTab(bug.screenshot!)}
                      className="rounded border px-2 py-1 hover:bg-gray-50"
                    >
                      В новой вкладке
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 cursor-pointer"
        >
          <div onClick={(e) => e.stopPropagation()} className="relative max-w-full max-h-full">
            <img src={lightboxImage} alt="Скриншот" className="max-w-full max-h-[90vh] rounded-lg" />
            <div className="absolute -top-2 -right-2 flex gap-2">
              <button
                onClick={() => copyImageToClipboard(lightboxImage)}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium shadow hover:bg-gray-100"
              >
                Скопировать в буфер
              </button>
              <button
                onClick={() => setLightboxImage(null)}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium shadow hover:bg-gray-100"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="text-center text-xs text-muted-foreground pb-4">
        Хранение: localStorage браузера (~5 MB). При переполнении удали старые скрины.
        Для передачи в чат: «Текст в буфер» — описание; «Скрин в буфер» или «Открыть» — картинка.
      </div>
    </div>
  )
}
