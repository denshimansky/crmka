import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { cache } from "react"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  hasPermission,
  type PermissionKey,
  type RolePermissions,
} from "@/lib/permissions"

/**
 * Кэш чтения rolePermissions организации в рамках одного запроса.
 * React `cache` дедуплицирует одинаковые вызовы внутри одного RSC/route handler.
 */
const getOrgRolePermissions = cache(
  async (tenantId: string): Promise<RolePermissions | null> => {
    const org = await db.organization.findUnique({
      where: { id: tenantId },
      select: { rolePermissions: true },
    })
    return (org?.rolePermissions as RolePermissions | null) ?? null
  }
)

/**
 * Гард для API-роутов. Использование:
 *
 *   const guard = await requirePermission("finance.view")
 *   if (!guard.ok) return guard.response
 *   const { session } = guard
 *
 * Возвращает 401, если не залогинен; 403, если у роли нет разрешения.
 * Owner всегда проходит.
 */
export async function requirePermission(permission: PermissionKey): Promise<
  | { ok: true; session: Awaited<ReturnType<typeof getServerSession>> & { user: { role: string; tenantId: string } } }
  | { ok: false; response: NextResponse }
> {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  const role = (session.user as { role?: string }).role
  const tenantId = (session.user as { tenantId?: string }).tenantId

  if (!role || !tenantId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  if (role === "owner") {
    return { ok: true, session: session as never }
  }

  const perms = await getOrgRolePermissions(tenantId)
  if (!hasPermission(role as Parameters<typeof hasPermission>[0], permission, perms)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Недостаточно прав для этого действия" },
        { status: 403 }
      ),
    }
  }

  return { ok: true, session: session as never }
}
