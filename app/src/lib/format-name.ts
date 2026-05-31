// Единый формат отображения ФИО.
// Везде в UI используем порядок «Фамилия Имя» — как для родителей,
// так и для подопечных и сотрудников. Если фамилии нет — показываем имя.

interface NameParts {
  firstName: string | null
  lastName: string | null
}

interface FullNameParts extends NameParts {
  patronymic?: string | null
}

const FALLBACK = "Без имени"

/**
 * Подопечный / сотрудник: «Фамилия Имя».
 * Если фамилии нет — только имя. Если ничего нет — FALLBACK.
 */
export function formatWardName(w: NameParts, fallback: string = FALLBACK): string {
  return [w.lastName, w.firstName].filter(Boolean).join(" ") || fallback
}

/**
 * Полное ФИО клиента: «Фамилия Имя Отчество». Совпадает с тем, что показывается
 * в карточке клиента, в шапке.
 */
export function formatPersonFullName(
  p: FullNameParts,
  fallback: string = FALLBACK,
): string {
  return [p.lastName, p.firstName, p.patronymic].filter(Boolean).join(" ") || fallback
}
