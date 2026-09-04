"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ClientComboboxOption {
  id: string
  name: string
  /** Телефон клиента (в любом формате). Если задан — по нему тоже идёт поиск и
   *  он показывается в строке выпадашки для точной идентификации. */
  phone?: string
}

/** Настройка серверного режима поиска (см. GET /api/clients/search). */
export interface ClientComboboxServerSearch {
  /** "all" — без фильтра статуса (пикер задач); иначе исключаем архив/ЧС. */
  status?: "all" | "payable"
  /** Искать и показывать телефон (оплаты/возвраты — тёзки по номеру). */
  withPhone?: boolean
  /** Эндпоинт. По умолчанию /api/clients/search. */
  url?: string
}

interface ClientComboboxProps {
  value: string
  onChange: (id: string) => void
  /** Вызывается вместе с onChange, но получает всю выбранную опцию (или null при
   *  сбросе). Нужен, когда родителю нужно имя выбранного (серверный режим не
   *  держит полный список — имя иначе взять негде). */
  onSelect?: (option: ClientComboboxOption | null) => void
  placeholder?: string
  /** Сколько строк показывать максимум в выпадашке. По умолчанию 50 — чтобы DOM
   *  не вспух (локальный режим) / сколько грузить с сервера (серверный режим). */
  maxResults?: number
  className?: string
  /** ЛОКАЛЬНЫЙ режим: полный список, фильтрация по подстроке на клиенте.
   *  Используется, когда список заведомо небольшой и уже на руках (напр. список
   *  инструкторов). Если задан serverSearch — options игнорируется. */
  options?: ClientComboboxOption[]
  /** СЕРВЕРНЫЙ режим: поиск-по-мере-ввода через API (вся база клиентов, без
   *  загрузки её целиком в браузер). Если задан — режим серверный. */
  serverSearch?: ClientComboboxServerSearch
  /** Серверный режим: подпись предвыбранного value, когда список ещё не загружен
   *  (напр. форма открыта с уже выбранным клиентом). */
  initialOption?: ClientComboboxOption | null
  /** Иконка слева в поле (напр. <Baby/> у фильтра расписания по ребёнку). */
  icon?: React.ReactNode
}

/**
 * Селект-комбобокс с поиском по подстроке (по имени и телефону).
 * Поиск по имени — без учёта регистра; по телефону — по цифрам (форматирование
 * номера в запросе и в данных игнорируется). Если введён непустой запрос — снимает
 * выбранного клиента пока пользователь не выберет вариант из выпадашки.
 *
 * Два режима:
 *  - локальный (`options`): фильтрация на клиенте по всему переданному списку;
 *  - серверный (`serverSearch`): запрос к /api/clients/search по мере ввода —
 *    для больших баз, где грузить всех клиентов в браузер нельзя.
 */
export function ClientCombobox({
  value,
  onChange,
  onSelect,
  placeholder = "Выберите клиента",
  maxResults = 50,
  className,
  options,
  serverSearch,
  initialOption = null,
  icon,
}: ClientComboboxProps) {
  const server = !!serverSearch
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const containerRef = React.useRef<HTMLDivElement>(null)

  // При клике вне комбобокса — закрываем и сбрасываем введённый запрос
  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const q = query.trim().toLowerCase()

  // ——— Серверный режим: состояние результатов, дебаунс, запомненный выбор ———
  const [results, setResults] = React.useState<ClientComboboxOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [picked, setPicked] = React.useState<ClientComboboxOption | null>(
    initialOption && initialOption.id === value ? initialOption : null,
  )

  const ssStatus = serverSearch?.status
  const ssPhone = serverSearch?.withPhone
  const ssUrl = serverSearch?.url

  // Внешний сброс value (напр. кнопка «убрать привязку») — забываем выбранного.
  React.useEffect(() => {
    if (!server) return
    if (!value) setPicked(null)
  }, [server, value])

  React.useEffect(() => {
    if (!server || !open) return
    const controller = new AbortController()
    // Пустой запрос показываем сразу (первые N), для непустого — дебаунс 250мс.
    const delay = q ? 250 : 0
    const handle = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (q) params.set("q", q)
        params.set("limit", String(maxResults))
        if (ssStatus) params.set("status", ssStatus)
        if (ssPhone) params.set("withPhone", "1")
        const base = ssUrl ?? "/api/clients/search"
        const res = await fetch(`${base}?${params.toString()}`, { signal: controller.signal })
        if (!res.ok) { setResults([]); return }
        const data = await res.json()
        setResults(Array.isArray(data.clients) ? data.clients : [])
      } catch (e) {
        if ((e as { name?: string })?.name !== "AbortError") setResults([])
      } finally {
        setLoading(false)
      }
    }, delay)
    return () => { clearTimeout(handle); controller.abort() }
  }, [server, open, q, maxResults, ssStatus, ssPhone, ssUrl])

  // ——— Локальный режим ———
  const localOptions = React.useMemo(() => options ?? [], [options])
  const qDigits = q.replace(/\D/g, "")
  const localFiltered = React.useMemo(() => {
    if (server) return []
    if (!q) return localOptions.slice(0, maxResults)
    return localOptions
      .filter((o) => {
        if (o.name.toLowerCase().includes(q)) return true
        if (qDigits && o.phone) return o.phone.replace(/\D/g, "").includes(qDigits)
        return false
      })
      .slice(0, maxResults)
  }, [server, localOptions, q, qDigits, maxResults])

  const localSelected = React.useMemo(
    () => (server ? null : localOptions.find((o) => o.id === value) ?? null),
    [server, localOptions, value],
  )

  // Что показываем в поле: пока открыт — что печатает юзер; пока закрыт — имя
  // выбранного (серверный режим держит его в picked, локальный — ищет в options).
  const selectedName = server ? picked?.name ?? "" : localSelected?.name ?? ""
  const display = open ? query : selectedName

  const items = server ? results : localFiltered

  function handlePick(o: ClientComboboxOption) {
    onChange(o.id)
    onSelect?.(o)
    if (server) setPicked(o)
    setQuery("")
    setOpen(false)
  }

  // Подсказка «уточните запрос»: список, вероятно, обрезан лимитом.
  const showMoreHint = server
    ? !loading && !q && results.length >= maxResults
    : !q && localOptions.length > maxResults

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute top-1/2 left-2.5 flex -translate-y-1/2 items-center text-muted-foreground [&_svg]:size-3.5">
            {icon}
          </span>
        )}
        <Input
          value={display}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true)
            setQuery("")
          }}
          onChange={(e) => {
            setOpen(true)
            setQuery(e.target.value)
          }}
          className={cn("pr-8", icon && "pl-7")}
        />
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {server && loading && items.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">Поиск…</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">Ничего не найдено</div>
          ) : (
            items.map((o) => (
              <button
                key={o.id}
                type="button"
                onMouseDown={(e) => {
                  // Используем mousedown, чтобы клик отработал до blur и не потерять выбор
                  e.preventDefault()
                  handlePick(o)
                }}
                className={cn(
                  "block w-full px-3 py-2 text-left text-sm hover:bg-accent",
                  o.id === value && "bg-accent/50 font-medium",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{o.name}</span>
                  {o.phone && (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {o.phone}
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
          {showMoreHint && (
            <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">
              {server
                ? `Показаны первые ${maxResults}. Уточните запрос.`
                : `Показано ${maxResults} из ${localOptions.length}. Уточните запрос.`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
