// Сокращение длинных названий групп в табличных колонках "Группа".
// Полное имя показывается во всплывающей подсказке (title).

const GROUP_NAME_MAX = 10

export function truncateGroupName(name: string | null | undefined): string {
  if (!name) return "—"
  return name.length > GROUP_NAME_MAX ? name.slice(0, GROUP_NAME_MAX) + "…" : name
}
