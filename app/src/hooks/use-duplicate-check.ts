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

const STATUS_LABELS: Record<string, string> = {
  new: "Новый лид",
  trial_scheduled: "Пробное записано",
  trial_attended: "Пробное пройдено",
  awaiting_payment: "Ожидание оплаты",
  active_client: "Активный клиент",
  potential: "Потенциальный",
  non_target: "Не целевой",
  blacklisted: "Чёрный список",
  archived: "Архив",
  active: "Активный клиент",
  upsell: "Допродажа",
  churned: "Отток",
  returning: "Возврат",
}

export function getStatusLabel(match: DuplicateMatch): string {
  if (match.clientStatus) return STATUS_LABELS[match.clientStatus] || match.clientStatus
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
