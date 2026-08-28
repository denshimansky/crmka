import { NextResponse } from "next/server"
import crypto from "crypto"
import { db } from "@/lib/db"
import { resolveBranchScope } from "@/lib/session"
import type { BranchScope } from "@/lib/branch-scope"
import { hasPermission, type PermissionKey } from "@/lib/permissions"
import type { Role } from "@prisma/client"
import { extCorsHeaders } from "@/lib/ext-cors"

/**
 * Авторизация внешних клиентов CRMka (браузерное расширение-панель над
 * мессенджерами, см. docs/messenger-extension.md).
 *
 * Почему отдельная поверхность, а не requirePermission: next-auth держит сессию
 * в httpOnly-cookie домена CRMka с SameSite=lax — страница web.telegram.org её
 * не отправит. Плюс requirePermission намертво завязан на getServerSession, и
 * смешивание двух источников идентичности в одном гарде размазало бы
 * security-инварианты. Образец — portal-auth.ts (ЛК родителя): такой же
 * самостоятельный слой.
 *
 * Ключевое отличие от JWT-сессии: всё читается из БД на КАЖДЫЙ запрос, поэтому
 * отзыв токена, увольнение сотрудника, смена привязки филиалов и блокировка за
 * неоплату действуют мгновенно — без 5-минутного лага рефреша JWT (lib/auth.ts).
 *
 * Токен НИКОГДА не даёт прав шире самого сотрудника:
 *   эффективные права = скоупы токена ∩ права роли по матрице ∩ филиалы сотрудника.
 */

export type ExtScope = "ext.read" | "ext.write" | "ext.ai"

/** Префикс секрета: по нему сразу видно, что это токен CRMka. */
export const EXT_TOKEN_PREFIX = "crmka_"

/** Сколько символов секрета показываем в списке токенов (как у GitHub PAT). */
export const EXT_TOKEN_VISIBLE_PREFIX_LENGTH = EXT_TOKEN_PREFIX.length + 8

/**
 * Скоуп → право по матрице организации. Токен со скоупом ext.write у роли, у
 * которой нет clients.edit, писать не сможет. Финансовых скоупов сознательно
 * нет: панель показывает платежи как часть карточки клиента, но не создаёт их
 * (приём оплаты из чата — v2, тогда появится отдельный скоуп + finance.edit).
 */
const SCOPE_PERMISSION: Record<ExtScope, PermissionKey> = {
  "ext.read": "clients.view",
  "ext.write": "clients.edit",
  "ext.ai": "clients.view",
}

/**
 * Скоупы, недоступные при блокировке за неоплату: пишущие и платный ИИ.
 * ext.ai стоит нам живых денег у провайдера, поэтому режется наравне с записью
 * (читать карточку заблокированной организации по-прежнему можно — CRM в этом
 * режиме тоже остаётся в просмотре).
 */
const BLOCKED_SCOPES: ReadonlySet<ExtScope> = new Set<ExtScope>(["ext.write", "ext.ai"])

/** Токен, выдаваемый по умолчанию при выпуске из «Настройки → Расширение». */
export const DEFAULT_EXT_SCOPES: ExtScope[] = ["ext.read", "ext.write", "ext.ai"]

export interface ExtContext {
  tenantId: string
  employeeId: string
  role: Role
  branchScope: BranchScope
  /** Видит ли роль телефоны клиентов (настройка организации). */
  instructorsSeePhones: boolean
  tokenId: string
  /** Имя сотрудника: им подписываются шаблоны и журнал ИИ-черновиков. */
  employeeName: string | null
}

export type ExtAuthResult =
  | { ok: true; ctx: ExtContext }
  | { ok: false; response: NextResponse }

/** Секрет → его sha256-hex. Единая точка: выпуск и проверка обязаны совпадать. */
export function hashExtToken(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex")
}

/** Новый секрет токена: crmka_<43 символа base64url>. */
export function generateExtToken(): { secret: string; hash: string; prefix: string } {
  const secret = EXT_TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url")
  return {
    secret,
    hash: hashExtToken(secret),
    prefix: secret.slice(0, EXT_TOKEN_VISIBLE_PREFIX_LENGTH),
  }
}

/** Разбор заголовка Authorization: Bearer <secret>. */
function readBearer(req: Request): string | null {
  const raw = req.headers.get("authorization")
  if (!raw) return null
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim())
  return match ? match[1].trim() : null
}

function fail(req: Request, status: number, error: string, code?: string): ExtAuthResult {
  return {
    ok: false,
    response: NextResponse.json(
      code ? { error, code } : { error },
      { status, headers: extCorsHeaders(req) },
    ),
  }
}

/**
 * Гард для роутов /api/ext/*. Использование:
 *
 *   const guard = await requireExtAuth(req, "ext.read")
 *   if (!guard.ok) return guard.response
 *   const { tenantId, employeeId, branchScope } = guard.ctx
 *
 * Внимание: /api/ext исключён из matcher middleware (иначе withAuth редиректил
 * бы на /login запрос без cookie), поэтому режим «счёт не оплачен» для этой
 * поверхности энфорсится здесь, а не в middleware.
 */
export async function requireExtAuth(req: Request, scope: ExtScope): Promise<ExtAuthResult> {
  const secret = readBearer(req)
  if (!secret) {
    return fail(req, 401, "Нужен токен доступа: Authorization: Bearer <токен>")
  }

  const token = await db.apiToken.findUnique({
    where: { tokenHash: hashExtToken(secret) },
    select: {
      id: true,
      tenantId: true,
      employeeId: true,
      scopes: true,
      revokedAt: true,
      expiresAt: true,
      lastUsedAt: true,
    },
  })
  if (!token) return fail(req, 401, "Недействительный токен")
  if (token.revokedAt) return fail(req, 401, "Токен отозван")
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) {
    return fail(req, 401, "Срок действия токена истёк")
  }

  const scopes = Array.isArray(token.scopes) ? (token.scopes as unknown[]) : []
  if (!scopes.includes(scope)) {
    return fail(req, 403, "Токену не выдано это разрешение")
  }

  // Сотрудник и организация читаются на каждый запрос: уволенный сотрудник или
  // заблокированная за неоплату организация теряют доступ немедленно.
  const employee = await db.employee.findFirst({
    where: { id: token.employeeId, tenantId: token.tenantId, deletedAt: null, isActive: true },
    select: {
      id: true,
      role: true,
      firstName: true,
      organization: {
        select: { rolePermissions: true, billingStatus: true, instructorsSeePhones: true },
      },
      employeeBranches: { select: { branchId: true } },
    },
  })
  if (!employee) return fail(req, 401, "Сотрудник неактивен")

  const org = employee.organization
  if (org.billingStatus === "blocked" && BLOCKED_SCOPES.has(scope)) {
    return fail(
      req,
      403,
      "Счёт не оплачен — CRM в режиме просмотра. Изменения недоступны.",
      "BILLING_READ_ONLY",
    )
  }

  const permission = SCOPE_PERMISSION[scope]
  const rolePermissions = (org.rolePermissions ?? null) as Parameters<typeof hasPermission>[2]
  if (!hasPermission(employee.role, permission, rolePermissions)) {
    return fail(req, 403, "Недостаточно прав для этого действия")
  }

  // Филиалы считаем из БД той же единой точкой, что и сессия (coversAllBranches
  // и всё прочее), а не верим расширению на слово.
  //
  // Владелец и управляющий видят все филиалы ВСЕГДА, привязки им не сужают
  // доступ — ровно как в lib/auth.ts. Без этого гарда расширение расходилось с
  // CRM: у переведённого из администратора владельца строки в employee_branches
  // остаются (их же оставляет и soft-delete филиала), и через панель он получал
  // limited-scope и «Клиент не найден» там, где в CRM видит всех.
  const seesAllBranches = employee.role === "owner" || employee.role === "manager"
  const branchIds = employee.employeeBranches.map((b) => b.branchId)
  const branchScope = await resolveBranchScope(
    token.tenantId,
    seesAllBranches || branchIds.length === 0 ? null : branchIds,
  )

  // Отметка «когда токеном пользовались» — не чаще раза в минуту, чтобы не
  // писать в БД на каждый запрос панели. Ошибку глотаем: это телеметрия.
  const lastUsed = token.lastUsedAt?.getTime() ?? 0
  if (Date.now() - lastUsed > 60_000) {
    void db.apiToken
      .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {})
  }

  return {
    ok: true,
    ctx: {
      tenantId: token.tenantId,
      employeeId: employee.id,
      role: employee.role,
      branchScope,
      instructorsSeePhones: org.instructorsSeePhones,
      tokenId: token.id,
      employeeName: employee.firstName?.trim() || null,
    },
  }
}
