import { useEffect, useRef, useState } from "react"

export interface DuplicateMatch {
  id: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  phone2: string | null
  funnelStatus: string
  clientStatus: string | null
}

// Ярлыки совпадают с табами «Контакты» (/crm/contacts).
const STATUS_LABELS: Record<string, string> = {
  new: "Лид",
  trial_scheduled: "Пробное записано",
  trial_attended: "Пробное пройдено",
  awaiting_payment: "Ожидание оплаты",
  active_client: "Активный",
  potential: "Потенциал",
  non_target: "Нецелевой",
  blacklisted: "Чёрный список",
  archived: "Архив",
}

export function getStatusLabel(match: DuplicateMatch): string {
  if (match.clientStatus === "churned") return "Выбывший"
  return STATUS_LABELS[match.funnelStatus] || match.funnelStatus
}

export function useDuplicateCheck(phone: string) {
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([])
  const [checking, setChecking] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    // Очищаем предыдущий таймер
    if (timerRef.current) clearTimeout(timerRef.current)
    if (abortRef.current) abortRef.current.abort()

    const digits = phone.replace(/\D/g, "")
    if (digits.length < 4) {
      setDuplicates([])
      setChecking(false)
      return
    }

    setChecking(true)

    // Debounce 500ms
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch(
          `/api/clients/check-duplicate?phone=${encodeURIComponent(phone.trim())}`,
          { signal: controller.signal }
        )
        if (res.ok) {
          const data = await res.json()
          setDuplicates(data)
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          setDuplicates([])
        }
      } finally {
        setChecking(false)
      }
    }, 500)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [phone])

  return { duplicates, checking }
}
