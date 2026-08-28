// Колонки, значения ячеек и сортировка вкладок «Клиенты» — ОДИН источник правды
// для таблицы (contacts-table.tsx) и выгрузки в Excel (contacts-export-button.tsx).
//
// Кнопка «Скачать Excel» живёт в шапке страницы, рядом с «+ Клиент», а таблица —
// отдельный компонент ниже. Если бы каждый описывал колонки сам, файл разъезжался
// бы с экраном при первой же правке набора столбцов. Поэтому набор столбцов
// вкладки, подписи и то, как из строки достаётся значение, лежат здесь.

import { formatWardName } from "@/lib/format-name"
import { clientStateLabel } from "@/lib/clients/state-label"
import type { ContactRow, ContactsTabKey } from "./contacts-table"

/** Идентификаторы контентных столбцов — общие для сортировки, ресайза и выгрузки. */
export type ColId =
  | "state"
  | "parent"
  | "phone"
  | "social"
  | "birth"
  | "wards"
  | "segment"
  | "channel"
  | "branch"
  | "direction"
  | "group"
  | "instructor"
  | "created"
  | "nextContact"
  | "comment"
  | "assigned"

export type SortDir = "asc" | "desc"

export const SEGMENT_LABELS: Record<string, string> = {
  new_client: "Новый",
  standard: "Стандартный",
  regular: "Постоянный",
  vip: "VIP",
}

export function fullName(r: { firstName: string | null; lastName: string | null }): string {
  return [r.lastName, r.firstName].filter(Boolean).join(" ") || "Без имени"
}

export function wardsLabel(wards: ContactRow["wards"]): string {
  if (!wards.length) return "—"
  return wards.map((w) => formatWardName(w, "—")).join(", ")
}

export function firstWardBirth(wards: ContactRow["wards"]): string {
  const bd = wards.find((w) => w.birthDate)?.birthDate
  if (!bd) return "—"
  return new Date(bd).toLocaleDateString("ru-RU")
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("ru-RU")
}

export function stateLabel(r: ContactRow): string {
  // Единый источник правды со статусом в обзвоне и др. (баг #84).
  return clientStateLabel(r.funnelStatus, r.clientStatus)
}

/** Что нужно знать о строке помимо неё самой: подпись сотрудника и название роли. */
export interface ContactsCellCtx {
  employeeLabel: (id: string | null) => string
  instructorLabel: string
}

/**
 * Набор столбцов вкладки — в ТОМ ЖЕ порядке, что в шапке таблицы. Меняете
 * столбцы на экране — меняйте здесь, иначе выгрузка разойдётся с таблицей.
 */
export function columnsForTab(tab: ContactsTabKey, instructorLabel: string): {
  id: ColId
  header: string
  width: number
}[] {
  const has = (...tabs: ContactsTabKey[]) => tabs.includes(tab)
  const cols: { id: ColId; header: string; width: number }[] = []

  if (has("all")) cols.push({ id: "state", header: "Состояние", width: 16 })
  cols.push({ id: "parent", header: "ФИО родителя", width: 28 })
  cols.push({ id: "phone", header: "Телефон", width: 16 })
  cols.push({ id: "social", header: "Соцсети", width: 24 })
  if (has("churned", "archived", "blacklist")) {
    cols.push({ id: "birth", header: "Дата рождения", width: 16 })
  }
  if (has("leads", "potential", "nontarget", "active", "all")) {
    cols.push({ id: "wards", header: "Дети", width: 28 })
  }
  if (has("active")) cols.push({ id: "segment", header: "Сегмент", width: 14 })
  cols.push({ id: "branch", header: "Филиал", width: 20 })
  if (has("active")) {
    cols.push({ id: "direction", header: "Направление", width: 20 })
    cols.push({ id: "group", header: "Группа", width: 22 })
    cols.push({ id: "instructor", header: instructorLabel, width: 22 })
  }
  if (has("leads", "potential", "active", "churned")) {
    cols.push({ id: "nextContact", header: "След. связь", width: 14 })
  }
  if (has("leads", "potential", "nontarget", "active", "all")) {
    cols.push({ id: "comment", header: "Комментарий", width: 40 })
  }
  if (has("leads")) {
    cols.push({ id: "channel", header: "Канал", width: 18 })
    cols.push({ id: "created", header: "Дата создания", width: 16 })
  }
  if (has("leads", "potential", "nontarget", "active")) {
    cols.push({ id: "assigned", header: "Ответственный", width: 22 })
  }
  return cols
}

/**
 * Значение ячейки для ВЫГРУЗКИ. Отличия от экрана намеренные: пустое вместо «—»
 * (в Excel прочерк мешает фильтрам и сортировке) и полное название группы вместо
 * укороченного (обрезка — забота вёрстки, не файла).
 */
export function exportCell(r: ContactRow, key: ColId, ctx: ContactsCellCtx): string {
  const dash = (v: string) => (v === "—" ? "" : v)
  switch (key) {
    case "state":
      return stateLabel(r)
    case "parent":
      return fullName(r)
    case "phone":
      return r.phone || ""
    case "social":
      return r.socialLink || ""
    case "birth":
      return dash(firstWardBirth(r.wards))
    case "wards":
      return dash(wardsLabel(r.wards))
    case "segment":
      return SEGMENT_LABELS[r.segment] || ""
    case "channel":
      return r.channelName || ""
    case "branch":
      return r.branchName || ""
    case "direction":
      return r.activeSubscription?.directionName || ""
    case "group":
      return r.activeSubscription?.groupName || ""
    case "instructor":
      return dash(r.activeSubscription?.instructor.name || "")
    case "created":
      return dash(fmtDate(r.createdAt))
    case "nextContact":
      return dash(fmtDate(r.nextContactDate))
    case "comment":
      return r.comment || ""
    case "assigned":
      return ctx.employeeLabel(r.assignedTo)
  }
}

/** Сравнимое значение для сортировки: даты → ISO (естественный порядок),
 *  остальное → строка в нижнем регистре. Пустые уходят в конец. */
export function sortValue(r: ContactRow, key: ColId, ctx: ContactsCellCtx): string {
  switch (key) {
    case "state":
      return stateLabel(r).toLowerCase()
    case "parent":
      return fullName(r).toLowerCase()
    case "phone":
      return (r.phone || "").toLowerCase()
    case "social":
      return (r.socialLink || "").toLowerCase()
    case "birth":
      return r.wards.find((w) => w.birthDate)?.birthDate || ""
    case "wards":
      return wardsLabel(r.wards) === "—" ? "" : wardsLabel(r.wards).toLowerCase()
    case "segment":
      return (SEGMENT_LABELS[r.segment] || "").toLowerCase()
    case "channel":
      return (r.channelName || "").toLowerCase()
    case "branch":
      return (r.branchName || "").toLowerCase()
    case "direction":
      return (r.activeSubscription?.directionName || "").toLowerCase()
    case "group":
      return (r.activeSubscription?.groupName || "").toLowerCase()
    case "instructor":
      return r.activeSubscription?.instructor.name === "—"
        ? ""
        : (r.activeSubscription?.instructor.name || "").toLowerCase()
    case "created":
      return r.createdAt || ""
    case "nextContact":
      return r.nextContactDate || ""
    case "comment":
      return (r.comment || "").toLowerCase()
    case "assigned":
      return ctx.employeeLabel(r.assignedTo).toLowerCase()
  }
}

export function sortRows(
  rows: ContactRow[],
  sortKey: ColId | null,
  sortDir: SortDir,
  ctx: ContactsCellCtx,
): ContactRow[] {
  if (!sortKey) return rows
  const sign = sortDir === "asc" ? 1 : -1
  const copy = [...rows]
  copy.sort((a, b) => {
    const va = sortValue(a, sortKey, ctx)
    const vb = sortValue(b, sortKey, ctx)
    // Пустые в конец независимо от направления
    const ae = va === ""
    const be = vb === ""
    if (ae && !be) return 1
    if (!ae && be) return -1
    if (va === vb) return 0
    return va.localeCompare(vb, "ru") * sign
  })
  return copy
}

/** Ключ sessionStorage, в котором таблица держит выбранную сортировку вкладки. */
export function sortStorageKey(tab: ContactsTabKey): string {
  return `contacts-sort:${tab}`
}

/**
 * Сортировка, выбранная пользователем в таблице. Кнопка выгрузки живёт в шапке
 * и о состоянии таблицы не знает — читает его из того же sessionStorage, куда
 * таблица пишет при каждом клике по заголовку. Так файл выходит в том же
 * порядке, что на экране.
 */
export function readStoredSort(tab: ContactsTabKey): { key: ColId | null; dir: SortDir } {
  try {
    const raw = sessionStorage.getItem(sortStorageKey(tab))
    if (raw) {
      const s = JSON.parse(raw) as { key?: ColId | null; dir?: SortDir }
      if (s?.key) return { key: s.key, dir: s.dir === "desc" ? "desc" : "asc" }
    }
  } catch {
    /* приватный режим / недоступный storage — берём серверный порядок */
  }
  return { key: null, dir: "asc" }
}
