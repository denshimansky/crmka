"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"

interface KbSearchResult {
  articleSlug: string
  sectionSlug: string
  sectionTitle: string
  title: string
  snippet: string
  href: string
}

export function KbSearch() {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<KbSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetch(`/api/kb/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((data: KbSearchResult[]) => {
          setResults(data)
          setOpen(true)
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    }, 250)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q])

  // Закрытие выпадашки по клику вне.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  return (
    <div ref={boxRef} className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Поиск по базе знаний"
        className="pl-8 pr-8"
      />
      {q && (
        <button
          type="button"
          onClick={() => { setQ(""); setResults([]); setOpen(false) }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Очистить"
        >
          <X className="size-4" />
        </button>
      )}

      {open && q.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-96 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {loading && results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">Поиск…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">Ничего не найдено</div>
          ) : (
            results.map((r) => (
              <Link
                key={r.href}
                href={r.href}
                onClick={() => setOpen(false)}
                className="block rounded-sm px-3 py-2 hover:bg-accent"
              >
                <div className="text-sm font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground">{r.sectionTitle}</div>
                {r.snippet && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.snippet}</div>}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  )
}
