// Типы и подписи отчёта CRM-13 «Воронка продаж».
// Отдельный файл без серверных импортов — используется и клиентскими компонентами.

export type FunnelTab = "new" | "existing"
export type FunnelSchemeKey = "with_trial" | "no_trial"
export type FunnelStageKey = "lead" | "application" | "trial" | "trial_attended" | "won"

export const FUNNEL_TAB_LABELS: Record<FunnelTab, string> = {
  new: "Новые",
  existing: "Действующие",
}

export const FUNNEL_SCHEME_LABELS: Record<FunnelSchemeKey, string> = {
  with_trial: "С пробным",
  no_trial: "Без пробного",
}

export const FUNNEL_STAGE_LABELS: Record<FunnelStageKey, string> = {
  lead: "Лид",
  application: "Заявка",
  trial: "Пробное",
  trial_attended: "Пришёл на пробное",
  won: "Купил",
}

export interface FunnelDetailRow {
  clientId: string
  parentName: string
  phone: string | null
  wardName: string | null
  branchName: string | null
  directionName: string | null
  groupName: string | null
  /** Заявка создана до выбранного месяца (перетекающая). */
  carryover: boolean
  /** Дата события этапа (ISO). */
  date: string
}

export interface FunnelStage {
  key: FunnelStageKey
  current: number
  carryover: number
  rows: FunnelDetailRow[]
}

export interface FunnelScheme {
  key: FunnelSchemeKey
  stages: FunnelStage[]
}

export interface SalesFunnelData {
  new: FunnelScheme[]
  existing: FunnelScheme[]
}
