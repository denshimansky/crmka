// Сегментация активных клиентов: Новый / Стандартный / Постоянный / VIP.
// Владелец в Настройках выбирает режим («сумма» — отработанная выручка
// клиента в ₽; «время» — месяцев с первой оплаты) и пороги для трёх верхних
// сегментов. Сегмент вычисляется лениво при отображении (карточка клиента,
// таблица контактов). Поле Client.segment в БД оставлено для совместимости
// со старыми отчётами, но больше не используется для UI.

export type SegmentationMode = "amount" | "months"

export type ClientSegmentKey =
  | "new_client"
  | "standard"
  | "regular"
  | "vip"

export interface SegmentationThresholds {
  /** Граница «Стандартный» (включительно). Всё, что ниже — «Новый». */
  standard: number
  /** Граница «Постоянный» (включительно). */
  regular: number
  /** Граница «VIP» (включительно). */
  vip: number
}

export interface SegmentationConfig {
  mode: SegmentationMode
  thresholds: SegmentationThresholds
}

export const SEGMENT_LABELS: Record<ClientSegmentKey, string> = {
  new_client: "Новый",
  standard: "Стандартный",
  regular: "Постоянный",
  vip: "VIP",
}

/** Порядок сегментов от младшего к старшему (для перебора в UI/отчётах). */
export const SEGMENT_ORDER: ClientSegmentKey[] = [
  "new_client",
  "standard",
  "regular",
  "vip",
]

/**
 * Эффективный сегмент клиента: ручное переопределение (Client.segmentOverride)
 * побеждает авто-расчёт. Используется везде, где сегмент показывается или
 * считается (карточка, вкладка «Активные», отчёт «Сегментация»).
 */
export function effectiveSegment(
  override: ClientSegmentKey | null | undefined,
  computed: ClientSegmentKey,
): ClientSegmentKey {
  return override ?? computed
}

/**
 * Подпись сегмента с диапазоном порога для отчёта/UI:
 *   amount → «Стандартный (≥ 50 000 ₽)», months → «Постоянный (≥ 6 мес.)».
 * Без конфига (config = null) — только название сегмента.
 */
export function segmentRangeLabel(
  key: ClientSegmentKey,
  config: SegmentationConfig | null,
): string {
  const name = SEGMENT_LABELS[key]
  if (!config) return name
  const unit = config.mode === "amount" ? "₽" : "мес."
  const fmt = (n: number) =>
    config.mode === "amount" ? new Intl.NumberFormat("ru-RU").format(n) : String(n)
  const t = config.thresholds
  switch (key) {
    case "new_client":
      return `${name} (< ${fmt(t.standard)} ${unit})`
    case "standard":
      return `${name} (≥ ${fmt(t.standard)} ${unit})`
    case "regular":
      return `${name} (≥ ${fmt(t.regular)} ${unit})`
    case "vip":
      return `${name} (≥ ${fmt(t.vip)} ${unit})`
  }
}

/** Подпись режима в UI. */
export const MODE_LABELS: Record<SegmentationMode, string> = {
  amount: "По сумме (₽ отработанной выручки клиента)",
  months: "По времени (месяцев с первой оплаты)",
}

/** Безопасный парсинг JSON-конфига из Organization.segmentationConfig. */
export function parseSegmentationConfig(raw: unknown): SegmentationConfig | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const mode = obj.mode === "amount" || obj.mode === "months" ? obj.mode : null
  const t = obj.thresholds as Record<string, unknown> | undefined
  if (!mode || !t) return null
  const standard = Number(t.standard)
  const regular = Number(t.regular)
  const vip = Number(t.vip)
  if (![standard, regular, vip].every((x) => Number.isFinite(x) && x >= 0)) {
    return null
  }
  return { mode, thresholds: { standard, regular, vip } }
}

/**
 * Возвращает сегмент клиента по метрике и конфигу.
 * Если конфиг null или метрика некорректная — «Новый».
 */
export function computeSegment(
  metric: number | null,
  config: SegmentationConfig | null,
): ClientSegmentKey {
  if (!config) return "new_client"
  const m = Number(metric)
  if (!Number.isFinite(m) || m < 0) return "new_client"
  if (m >= config.thresholds.vip) return "vip"
  if (m >= config.thresholds.regular) return "regular"
  if (m >= config.thresholds.standard) return "standard"
  return "new_client"
}

/** Месяцев между датой и сейчас. Возвращает 0, если firstPayment в будущем/null. */
export function monthsSince(firstPayment: Date | null | undefined, now = new Date()): number {
  if (!firstPayment) return 0
  const ms = now.getTime() - firstPayment.getTime()
  if (ms <= 0) return 0
  return ms / (1000 * 60 * 60 * 24 * 30.4375)
}

/** Вычисляет метрику клиента по выбранному режиму. */
export function metricForClient(
  config: SegmentationConfig,
  data: { totalChargedAmount: number; firstPaymentDate: Date | null },
  now = new Date(),
): number {
  return config.mode === "amount"
    ? data.totalChargedAmount
    : monthsSince(data.firstPaymentDate, now)
}
