import { cache } from "react"
import type { Role } from "@prisma/client"
import { db } from "@/lib/db"
import { resolveRoleDisplayNames } from "@/lib/roles"

/**
 * Кастомизируемые настройки организации, нужные на каждый рендер
 * (названия ролей + матрица прав). Обёрнуто в React cache — в рамках
 * одного запроса БД дёргается один раз, сколько бы серверных компонентов
 * ни вызвало хелпер (layout, страница, вложенные компоненты).
 */
export const getOrgUiSettings = cache(async (tenantId: string) => {
  return db.organization.findUnique({
    where: { id: tenantId },
    select: {
      roleDisplayNames: true,
      rolePermissions: true,
      currency: true,
      currencyChosen: true,
    },
  })
})

/**
 * Отображаемые названия ролей организации (кастомные поверх дефолтных).
 */
export async function getRoleNames(
  tenantId: string,
): Promise<Record<Role, string>> {
  const org = await getOrgUiSettings(tenantId)
  return resolveRoleDisplayNames(
    org?.roleDisplayNames as Record<string, string> | null,
  )
}
