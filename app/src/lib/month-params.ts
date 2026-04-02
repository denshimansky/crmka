/** Хелпер для server components: получить year/month из searchParams */
export function getMonthFromParams(searchParams: Record<string, string | string[] | undefined>) {
  const now = new Date()
  const year = Number(searchParams.year) || now.getFullYear()
  const month = Number(searchParams.month) || now.getMonth() + 1
  return { year, month }
}
