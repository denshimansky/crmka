export type StatusOption = { value: string; label: string }
export type SelectorMode = "transition" | "funnel"

// Пресейл-воронка для тех, кто никогда не был клиентом.
const FUNNEL_OPTIONS: StatusOption[] = [
  { value: "new", label: "Лид" },
  { value: "potential", label: "Потенциальный" },
  { value: "non_target", label: "Не целевой" },
  { value: "blacklisted", label: "Чёрный список" },
  { value: "archived", label: "Архив" },
]

/**
 * Набор опций селектора статуса на карточке клиента.
 * - transition: значения active/churned роутятся в clientStatus, остальные — в funnelStatus.
 * - funnel: обычный селектор воронки (никогда не клиент).
 * Бывшему клиенту (wasEverClient) недоступен «Потенциальный», но доступны «В Выбывшие».
 */
export function statusSelectorOptions(p: {
  isActiveClient: boolean
  wasEverClient: boolean
  clientStatus: string | null
}): { mode: SelectorMode; options: StatusOption[] } {
  const churned = p.clientStatus === "churned"

  if (p.isActiveClient) {
    const head: StatusOption = churned
      ? { value: "active", label: "Вернуть в Активные" }
      : { value: "churned", label: "В Выбывшие" }
    return { mode: "transition", options: [head, { value: "archived", label: "В Архив" }, { value: "blacklisted", label: "В Чёрный список" }] }
  }

  if (p.wasEverClient) {
    const head: StatusOption = churned
      ? { value: "active", label: "Вернуть в Активные" }
      : { value: "churned", label: "В Выбывшие" }
    return {
      mode: "transition",
      options: [
        head,
        { value: "new", label: "Лид" },
        { value: "non_target", label: "Не целевой" },
        { value: "blacklisted", label: "Чёрный список" },
        { value: "archived", label: "Архив" },
      ],
    }
  }

  return { mode: "funnel", options: FUNNEL_OPTIONS }
}
