// Маппинг текстового статуса из 1С на enum'ы Prisma + приоритет.
// Покрывает два формата выгрузки: «Состояние лида» (Лид/Потенциал/Выбыл/Архив/ЧС)
// и «Актив» (плюс Предзапись/Пробник/Продажа/Нецелевой лид).

import type { FunnelStatus, ClientWorkStatus } from "@prisma/client"

export type LeadStatus =
  | "Лид"
  | "Предзапись"
  | "Пробник"
  | "Потенциал"
  | "Нецелевой"
  | "Выбыл"
  | "Продажа"
  | "Архив"
  | "Черный список"

const STATUS_SYNONYMS: Record<string, LeadStatus> = {
  "лид": "Лид",
  // Предзапись = лид с датой следующего контакта в будущем (методология:
  // отдельного статуса в CRM нет, лиды сортируются по дате контакта).
  "предзапись": "Предзапись",
  "пробник": "Пробник",
  "потенциал": "Потенциал",
  "нецелевой лид": "Нецелевой",
  "нецелевой": "Нецелевой",
  "выбыл": "Выбыл",
  "выбывшие": "Выбыл",
  "выбывший": "Выбыл",
  "продажа": "Продажа",
  "архив": "Архив",
  "черный список": "Черный список",
  "чс": "Черный список",
}

export function parseStatus(raw: string | null | undefined): LeadStatus | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase().replace(/ё/g, "е")
  return STATUS_SYNONYMS[key] ?? null
}

// «Лидоподобные» статусы — новая воронка (клиентской истории ещё нет).
// Их сочетание с клиентскими статусами на одном ребёнке/телефоне — противоречие,
// которое этап 1 отдаёт владельцу как конфликт (см. detectConflicts).
export const LEAD_LIKE: ReadonlySet<LeadStatus> = new Set([
  "Лид",
  "Предзапись",
  "Пробник",
])

// Приоритет: чем выше — тем главнее, если на одном телефоне дети в разных статусах.
const PRIORITY: Record<LeadStatus, number> = {
  "Черный список": 9,
  "Архив": 8,
  "Продажа": 7,
  "Выбыл": 6,
  "Потенциал": 5,
  "Нецелевой": 4,
  "Пробник": 3,
  "Предзапись": 2,
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
    case "Предзапись":
      return { funnelStatus: "new", clientStatus: null }
    case "Пробник":
      return { funnelStatus: "trial_scheduled", clientStatus: null }
    case "Потенциал":
      return { funnelStatus: "potential", clientStatus: null }
    case "Нецелевой":
      return { funnelStatus: "non_target", clientStatus: null }
    case "Выбыл":
      return { funnelStatus: "active_client", clientStatus: "churned" }
    case "Продажа":
      return { funnelStatus: "active_client", clientStatus: "active" }
    case "Архив":
      return { funnelStatus: "archived", clientStatus: null }
    case "Черный список":
      return { funnelStatus: "blacklisted", clientStatus: null }
  }
}
