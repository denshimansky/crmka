/**
 * Человекочитаемый «Статус клиента» — единый источник правды для раздела
 * «Клиенты» (вкладка «Все»), обзвона и прочих мест, где нужен статус клиента
 * одной меткой.
 *
 * Комбинирует funnelStatus (enum, всегда задан) и clientStatus (work-status,
 * nullable). Порядок проверок = приоритет вкладок раздела «Клиенты»
 * (см. contacts-table.tsx). Всегда возвращает непустую метку: клиент без
 * work-status (потенциал/лид/архив/ЧС/нецелевой) больше не превращается в «—»
 * (баг #84: в обзвоне «Статус клиента» был пуст, т.к. читался только
 * clientStatus, который NULL у целых категорий — например «Потенциал»).
 */
export function clientStateLabel(
  funnelStatus: string,
  clientStatus: string | null,
): string {
  if (funnelStatus === "archived") return "Архив"
  if (funnelStatus === "blacklisted") return "Чёрный список"
  if (clientStatus === "active") return "Активный"
  if (clientStatus === "churned") return "Выбывший"
  if (funnelStatus === "non_target") return "Нецелевой"
  if (funnelStatus === "potential") return "Потенциал"
  return "Лид"
}
