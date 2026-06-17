import type { TaskAutoTrigger } from "@prisma/client"

/**
 * Настройки автотриггера задач — Ф6.2.
 *
 * Хранится в Organization.taskTriggerSettings (Json?) как массив TriggerSetting.
 * Если массив null или триггер не упомянут — считается включённым (обратная
 * совместимость, существующие тенанты получают всё как раньше).
 */
export interface TriggerSetting {
  trigger: TaskAutoTrigger
  enabled: boolean
  /** День месяца (1-31), начиная с которого триггер активен. null/undefined = всегда. */
  startDayOfMonth?: number | null
}

/** Перечень триггеров, которыми сейчас управляем через UI (соответствует /api/tasks/generate). */
export const MANAGED_TRIGGERS: TaskAutoTrigger[] = [
  "contact_date",
  "promised_payment",
  "first_paid_reminder",
  "birthday",
  "unmarked_lesson",
  "payment_due",
  "no_show_review",
]

export const TRIGGER_LABEL: Record<TaskAutoTrigger, string> = {
  contact_date: "Дата следующего контакта",
  promised_payment: "Обещанная дата оплаты",
  first_paid_reminder: "За день до 1-го платного (не оплачен абонемент)",
  birthday: "День рождения подопечного",
  unmarked_lesson: "Неотмеченные занятия (вчера)",
  payment_due: "Долгое ожидание оплаты (>3 дней)",
  no_show_review: "Уточнить «Не был» (старше 3 дней)",
  trial_reminder: "Напоминание о пробном",
  absence: "Пропуск занятия",
  missed_makeup: "Отработка не состоялась (переназначить)",
}

export function parseTriggerSettings(raw: unknown): TriggerSetting[] {
  if (!Array.isArray(raw)) return []
  const out: TriggerSetting[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const trigger = r.trigger as TaskAutoTrigger | undefined
    if (!trigger) continue
    const enabled = r.enabled === undefined ? true : Boolean(r.enabled)
    const dayRaw = r.startDayOfMonth
    const startDayOfMonth =
      typeof dayRaw === "number" && dayRaw >= 1 && dayRaw <= 31 ? dayRaw : null
    out.push({ trigger, enabled, startDayOfMonth })
  }
  return out
}

/**
 * Решает, должен ли работать триггер сейчас.
 *  - Если в настройках триггера нет — true (дефолт: включён).
 *  - Если enabled=false — false.
 *  - Если startDayOfMonth задан — true только если сегодня >= N.
 */
export function isTriggerEnabled(
  trigger: TaskAutoTrigger,
  settings: TriggerSetting[],
  today: Date,
): boolean {
  const s = settings.find((x) => x.trigger === trigger)
  if (!s) return true
  if (!s.enabled) return false
  if (s.startDayOfMonth && s.startDayOfMonth > 0) {
    const dayOfMonth = today.getDate()
    if (dayOfMonth < s.startDayOfMonth) return false
  }
  return true
}
