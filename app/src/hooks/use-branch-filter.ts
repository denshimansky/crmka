"use client"

import { useCallback, useEffect, useState } from "react"

const STORAGE_KEY = "schedule:branchFilter"
export const BRANCH_ALL_VALUE = "all"

interface UseBranchFilterOptions {
  branches: { id: string }[]
  allowAll: boolean
  defaultBranchId: string
}

interface UseBranchFilterResult {
  branchId: string
  setBranchId: (id: string) => void
  hydrated: boolean
}

/**
 * Управляет выбором филиала в расписании.
 *
 * Хранит значение в localStorage (`schedule:branchFilter`): UUID или
 * sentinel "all" — последний выбранный пользователем.
 *
 * - При монтировании читает storage и валидирует:
 *   - если "all", но allowAll=false — заменяет на defaultBranchId;
 *   - если UUID не найден в текущем списке филиалов — defaultBranchId.
 * - При изменении allowAll (например, переключили view на month, где «Все»
 *   запрещены) повторно валидирует значение.
 * - Любое изменение branchId пишется в storage.
 */
export function useBranchFilter({
  branches,
  allowAll,
  defaultBranchId,
}: UseBranchFilterOptions): UseBranchFilterResult {
  const [branchId, setBranchIdState] = useState<string>(defaultBranchId)
  const [hydrated, setHydrated] = useState(false)

  const validate = useCallback(
    (raw: string | null | undefined): string => {
      if (!raw) return defaultBranchId
      if (raw === BRANCH_ALL_VALUE) {
        return allowAll ? BRANCH_ALL_VALUE : defaultBranchId
      }
      return branches.some((b) => b.id === raw) ? raw : defaultBranchId
    },
    [allowAll, branches, defaultBranchId]
  )

  // Гидратация из storage один раз
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      setBranchIdState(validate(raw))
    } catch {
      /* ignore (приватный режим / quota) */
    }
    setHydrated(true)
    // намеренно один раз — последующие изменения allowAll ловим отдельным эффектом
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // При изменении allowAll/списка филиалов — повторная валидация
  useEffect(() => {
    if (!hydrated) return
    setBranchIdState((prev) => validate(prev))
  }, [hydrated, validate])

  // Сохранение в storage
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, branchId)
    } catch {
      /* ignore */
    }
  }, [branchId, hydrated])

  const setBranchId = useCallback((id: string) => {
    setBranchIdState(id)
  }, [])

  return { branchId, setBranchId, hydrated }
}
