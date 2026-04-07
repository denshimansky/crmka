import { db } from "@/lib/db"

/**
 * Проверяет, закрыт ли период для указанной даты.
 * Возвращает true если период закрыт И роль НЕ owner/manager.
 */
export async function isPeriodLocked(
  tenantId: string,
  date: Date,
  role: string
): Promise<boolean> {
  // Owner и manager могут редактировать закрытые периоды
  if (role === "owner" || role === "manager") return false

  const year = date.getFullYear()
  const month = date.getMonth() + 1

  const period = await db.period.findUnique({
    where: { tenantId_year_month: { tenantId, year, month } },
  })

  return period?.status === "closed"
}
