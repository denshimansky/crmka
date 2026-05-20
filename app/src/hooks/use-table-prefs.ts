"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

export type SortDir = "asc" | "desc"

/**
 * Хук состояния таблицы: порядок столбцов + текущая сортировка.
 * Состояние сохраняется в localStorage по ключу, чтобы переживало перезагрузку.
 */
export function useTablePrefs(opts: {
  storageKey: string
  defaultOrder: string[]
  defaultSort?: { key: string; dir: SortDir } | null
}) {
  const { storageKey, defaultOrder, defaultSort = null } = opts

  const [columnOrder, setColumnOrder] = useState<string[]>(defaultOrder)
  const [sortBy, setSortBy] = useState<string | null>(defaultSort?.key ?? null)
  const [sortDir, setSortDir] = useState<SortDir>(defaultSort?.dir ?? "asc")
  const [hydrated, setHydrated] = useState(false)

  // Подтягиваем сохранённые настройки после маунта
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as {
          columnOrder?: string[]
          sortBy?: string | null
          sortDir?: SortDir
        }
        // Сохраняем только колонки, которые всё ещё существуют
        if (Array.isArray(parsed.columnOrder)) {
          const valid = parsed.columnOrder.filter((k) => defaultOrder.includes(k))
          const missing = defaultOrder.filter((k) => !valid.includes(k))
          setColumnOrder([...valid, ...missing])
        }
        if (parsed.sortBy !== undefined) setSortBy(parsed.sortBy)
        if (parsed.sortDir === "asc" || parsed.sortDir === "desc") setSortDir(parsed.sortDir)
      }
    } catch {
      // ignore corrupt storage
    }
    setHydrated(true)
    // defaultOrder намеренно не в deps — поведение «один раз при маунте» по storageKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  // Сохраняем при изменении (после первичной гидратации, чтобы не затереть)
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ columnOrder, sortBy, sortDir }),
      )
    } catch {
      // ignore quota
    }
  }, [storageKey, columnOrder, sortBy, sortDir, hydrated])

  /** Клик по заголовку: asc → desc → off → asc … */
  const handleSortClick = useCallback((key: string) => {
    if (sortBy !== key) {
      setSortBy(key)
      setSortDir("asc")
      return
    }
    if (sortDir === "asc") {
      setSortDir("desc")
      return
    }
    // был desc → выключаем сортировку
    setSortBy(null)
  }, [sortBy, sortDir])

  /** Перемещение столбца: вырезаем из позиции from и вставляем перед to */
  const moveColumn = useCallback((from: string, to: string) => {
    if (from === to) return
    setColumnOrder((prev) => {
      const fromIdx = prev.indexOf(from)
      const toIdx = prev.indexOf(to)
      if (fromIdx === -1 || toIdx === -1) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIdx, 1)
      const insertAt = next.indexOf(to)
      next.splice(insertAt, 0, moved)
      return next
    })
  }, [])

  const resetPrefs = useCallback(() => {
    setColumnOrder(defaultOrder)
    setSortBy(defaultSort?.key ?? null)
    setSortDir(defaultSort?.dir ?? "asc")
  }, [defaultOrder, defaultSort])

  return useMemo(
    () => ({
      columnOrder,
      sortBy,
      sortDir,
      hydrated,
      handleSortClick,
      moveColumn,
      resetPrefs,
    }),
    [columnOrder, sortBy, sortDir, hydrated, handleSortClick, moveColumn, resetPrefs],
  )
}
