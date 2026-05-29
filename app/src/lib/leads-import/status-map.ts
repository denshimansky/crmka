// Маппинг текстового статуса из 1С на enum'ы Prisma + приоритет.

import type { FunnelStatus, ClientWorkStatus } from "@prisma/client"

export type LeadStatus =
  | "Лид"
  | "Потенциал"
  | "Выбыл"
  | "Архив"
  | "Черный список"

const STATUS_SYNONYMS: Record<string, LeadStatus> = {
  "лид": "Лид",
  "потенциал": "Потенциал",
  "выбыл": "Выбыл",
  "выбывшие": "Выбыл",
  "выбывший": "Выбыл",
  "архив": "Архив",
  "черный список": "Черный список",
  "чёрный список": "Черный список",
  "чс": "Черный список",
}

export function parseStatus(raw: string | null | undefined): LeadStatus | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase().replace(/ё/g, "е")
  return STATUS_SYNONYMS[key] ?? null
}

// Приоритет: чем выше — тем главнее, если на одном телефоне дети в разных статусах.
const PRIORITY: Record<LeadStatus, number> = {
  "Черный список": 5,
  "Архив": 4,
  "Выбыл": 3,
  "Потенциал": 2,
  "Лид": 1,
}

export function topStatus(statuses: LeadStatus[]): LeadStatus | null {
  let best: LeadStatus | null = null
  let bestPrio = -1
  for (const s of statuses) {
    const p = PRIORITY[s]
    if (p > bestPrio) {
      best = s
      bestPrio = p
    }
  }
  return best
}

export interface DbStatus {
  funnelStatus: FunnelStatus
  clientStatus: ClientWorkStatus | null
}

export function toDbStatus(status: LeadStatus): DbStatus {
  switch (status) {
    case "Лид":
      return { funnelStatus: "new", clientStatus: null }
    case "Потенциал":
      return { funnelStatus: "potential", clientStatus: null }
    case "Выбыл":
      return { funnelStatus: "active_client", clientStatus: "churned" }
    case "Архив":
      return { funnelStatus: "archived", clientStatus: null }
    case "Черный список":
      return { funnelStatus: "blacklisted", clientStatus: null }
  }
}
