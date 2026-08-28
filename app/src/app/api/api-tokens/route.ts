import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { DEFAULT_EXT_SCOPES, generateExtToken } from "@/lib/ext-auth"

/**
 * Управление персональными токенами доступа (PAT) сотрудника — их предъявляет
 * браузерное расширение-панель (docs/messenger-extension.md).
 *
 * Этот роут живёт под обычной cookie-сессией CRMka (в отличие от /api/ext/*,
 * который сам работает по токену): выпустить токен можно только из интерфейса
 * CRM, залогинившись обычным способом. Страница — /settings/extension.
 *
 * Правила доступа:
 *   • свои токены сотрудник видит, выпускает и отзывает сам (спец-права не нужны —
 *     токен не даёт ничего сверх того, что у сотрудника и так есть);
 *   • чужие токены видит и отзывает владелец/управляющий — нужно при увольнении.
 */

const createSchema = z.object({
  name: z.string().trim().min(1, "Укажите название устройства").max(100),
})

const deleteSchema = z.object({
  id: z.string().uuid(),
})

type SessionUser = { tenantId: string; employeeId: string; role: string }

function canManageOthers(role: string): boolean {
  return role === "owner" || role === "manager"
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { tenantId, employeeId, role } = session.user as unknown as SessionUser

  // Управляющему/владельцу показываем все токены организации, остальным — свои.
  const tokens = await db.apiToken.findMany({
    where: {
      tenantId,
      ...(canManageOthers(role) ? {} : { employeeId }),
      revokedAt: null,
    },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
      employeeId: true,
      employee: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({
    tokens: tokens.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      scopes: t.scopes,
      lastUsedAt: t.lastUsedAt,
      expiresAt: t.expiresAt,
      createdAt: t.createdAt,
      isMine: t.employeeId === employeeId,
      employeeName: [t.employee?.lastName, t.employee?.firstName].filter(Boolean).join(" ") || null,
    })),
    canManageOthers: canManageOthers(role),
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { tenantId, employeeId } = session.user as unknown as SessionUser

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }

  const { secret, hash, prefix } = generateExtToken()
  const token = await db.apiToken.create({
    data: {
      tenantId,
      employeeId,
      name: parsed.data.name,
      tokenHash: hash,
      prefix,
      scopes: DEFAULT_EXT_SCOPES,
    },
    select: { id: true, name: true, prefix: true, createdAt: true },
  })

  // Единственный момент, когда секрет виден: в БД лежит только его sha256.
  return NextResponse.json({ ...token, secret }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { tenantId, employeeId, role } = session.user as unknown as SessionUser

  const parsed = deleteSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: "Не указан токен" }, { status: 400 })
  }

  const token = await db.apiToken.findFirst({
    where: { id: parsed.data.id, tenantId },
    select: { id: true, employeeId: true },
  })
  if (!token) return NextResponse.json({ error: "Токен не найден" }, { status: 404 })

  if (token.employeeId !== employeeId && !canManageOthers(role)) {
    return NextResponse.json({ error: "Можно отозвать только свой токен" }, { status: 403 })
  }

  // Мягкий отзыв: строку не удаляем, чтобы в аудите оставался след, кем и когда
  // токен использовался. requireExtAuth проверяет revokedAt на каждом запросе.
  await db.apiToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } })

  return NextResponse.json({ ok: true })
}
