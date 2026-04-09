import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  getEffectivePermissions,
  PERMISSIONS,
  EDITABLE_ROLES,
  type RolePermissions,
  type PermissionKey,
} from "@/lib/permissions"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const org = await db.organization.findUnique({
    where: { id: session.user.tenantId },
    select: { rolePermissions: true },
  })

  const effective = getEffectivePermissions(
    org?.rolePermissions as RolePermissions | null
  )

  return NextResponse.json({ permissions: effective })
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Только owner может менять права ролей
  if (session.user.role !== "owner") {
    return NextResponse.json(
      { error: "Только владелец может настраивать права ролей" },
      { status: 403 }
    )
  }

  const body = await req.json()
  const incoming = body.permissions as RolePermissions | undefined

  if (!incoming || typeof incoming !== "object") {
    return NextResponse.json({ error: "Неверный формат данных" }, { status: 400 })
  }

  // Валидация: проверяем только допустимые роли и ключи
  const validKeys = new Set<string>(PERMISSIONS.map((p) => p.key))
  const validRoles = new Set(EDITABLE_ROLES.map((r) => String(r)))

  const cleaned: RolePermissions = {}

  for (const [role, perms] of Object.entries(incoming)) {
    // Пропускаем owner — его права не сохраняем (всегда true)
    if (role === "owner") continue
    if (!validRoles.has(role)) continue

    cleaned[role] = {} as Record<PermissionKey, boolean>
    for (const [key, value] of Object.entries(perms as Record<string, boolean>)) {
      if (validKeys.has(key) && typeof value === "boolean") {
        cleaned[role][key as PermissionKey] = value
      }
    }
  }

  await db.organization.update({
    where: { id: session.user.tenantId },
    data: { rolePermissions: cleaned },
  })

  const effective = getEffectivePermissions(cleaned)

  return NextResponse.json({ permissions: effective })
}
