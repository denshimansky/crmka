import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { hasPermission, type RolePermissions } from "@/lib/permissions"
import { normalizePhone } from "@/lib/phone"
import { generatePortalPassword, hashPortalPassword } from "@/lib/portal-password"
import { ensurePortalSlug } from "@/lib/portal-slug"
import { hasRequiredDocs } from "@/lib/portal-consents"
import { PORTAL_ORG_DOCS_SELECT } from "@/lib/portal-data"

// Учётка родителя в ЛК (/p/<slug>): выдача, перевыпуск пароля, отключение.
// Заменяет старую магическую ссылку (portal-link).

async function loadContext(clientId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const org = await db.organization.findUnique({
    where: { id: session.user.tenantId },
    select: { id: true, name: true, portalSlug: true, rolePermissions: true, ...PORTAL_ORG_DOCS_SELECT },
  })
  if (!org) return { error: NextResponse.json({ error: "Организация не найдена" }, { status: 404 }) }

  if (!hasPermission(session.user.role, "clients.edit", org.rolePermissions as RolePermissions | null)) {
    return { error: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) }
  }

  const client = await db.client.findFirst({
    where: { id: clientId, tenantId: session.user.tenantId, deletedAt: null },
    select: { id: true, phone: true, clientStatus: true, firstName: true, lastName: true },
  })
  if (!client) return { error: NextResponse.json({ error: "Клиент не найден" }, { status: 404 }) }

  return { session, org, client }
}

/** Есть ли в тенанте другой не удалённый клиент с тем же телефоном (по последним 10 цифрам). */
async function hasPhoneDuplicate(tenantId: string, clientId: string, loginPhone: string) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM clients
    WHERE tenant_id = ${tenantId}::uuid
      AND deleted_at IS NULL
      AND id <> ${clientId}::uuid
      AND length(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g')) >= 10
      AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = right(${loginPhone}, 10)
    LIMIT 1
  `
  return rows.length > 0
}

function baseUrl() {
  return process.env.NEXTAUTH_URL || "https://app.umnayacrm.ru"
}

// GET /api/clients/[id]/portal-account — статус учётки + проверки для диалога
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await loadContext(id)
  if ("error" in ctx) return ctx.error
  const { org, client } = ctx

  const loginPhone = normalizePhone(client.phone)
  const account = await db.clientPortalAccount.findUnique({
    where: { clientId: client.id },
    select: { loginPhone: true, isActive: true, passwordIssuedAt: true, lastLoginAt: true },
  })

  const checks = {
    phoneMissing: !client.phone,
    phoneInvalid: Boolean(client.phone) && !loginPhone,
    phoneDuplicate: loginPhone ? await hasPhoneDuplicate(org.id, client.id, loginPhone) : false,
    docsMissing: !hasRequiredDocs(org),
  }

  return NextResponse.json({
    account: account
      ? {
          // Логин = телефон в каноничном виде (сплошные цифры 7XXXXXXXXXX),
          // без плюсов/скобок/дефисов — именно его родитель вводит при входе.
          loginPhone: account.loginPhone,
          isActive: account.isActive,
          passwordIssuedAt: account.passwordIssuedAt,
          lastLoginAt: account.lastLoginAt,
        }
      : null,
    checks,
    portalUrl: org.portalSlug ? `${baseUrl()}/p/${org.portalSlug}` : null,
  })
}

// POST /api/clients/[id]/portal-account — выдать учётку / перевыпустить пароль.
// Пароль возвращается в открытом виде ЕДИНСТВЕННЫЙ раз — только в этом ответе.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await loadContext(id)
  if ("error" in ctx) return ctx.error
  const { session, org, client } = ctx

  if (!client.clientStatus) {
    return NextResponse.json(
      { error: "Доступ в кабинет выдаётся клиентам. Лид станет клиентом после первой оплаты." },
      { status: 422 }
    )
  }

  const loginPhone = normalizePhone(client.phone)
  if (!loginPhone) {
    return NextResponse.json(
      { error: "Укажите корректный российский телефон в карточке клиента — он станет логином." },
      { status: 422 }
    )
  }

  if (await hasPhoneDuplicate(org.id, client.id, loginPhone)) {
    return NextResponse.json(
      {
        error:
          "Этот телефон встречается ещё у одного клиента. Сначала разберитесь с дублями — телефон должен остаться у одного клиента.",
        code: "PHONE_DUPLICATE",
      },
      { status: 409 }
    )
  }

  if (!hasRequiredDocs(org)) {
    return NextResponse.json(
      {
        error:
          "Заполните ссылки на обязательные документы (оферта, политика, согласия на ПДн) в Настройках → Организация → Личный кабинет родителя.",
        code: "DOCS_MISSING",
      },
      { status: 422 }
    )
  }

  const slug = org.portalSlug || (await ensurePortalSlug(org.id))
  const password = generatePortalPassword()
  const passwordHash = await hashPortalPassword(password)

  try {
    await db.clientPortalAccount.upsert({
      where: { clientId: client.id },
      create: {
        tenantId: org.id,
        clientId: client.id,
        loginPhone,
        passwordHash,
        issuedBy: session.user.employeeId,
      },
      update: {
        loginPhone,
        passwordHash,
        passwordIssuedAt: new Date(),
        issuedBy: session.user.employeeId,
        isActive: true,
      },
    })
  } catch (e) {
    // P2002 по [tenantId, loginPhone]: телефон уже логин другой учётки —
    // у того клиента телефон в карточке сменили ПОСЛЕ выдачи (логин остался старым),
    // поэтому проверка дублей по clients его не увидела.
    if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
      return NextResponse.json(
        {
          error:
            "Этот телефон уже используется как логин кабинета другого клиента. Перевыпустите тому клиенту доступ (логин обновится на его текущий телефон) и повторите.",
          code: "PHONE_DUPLICATE",
        },
        { status: 409 }
      )
    }
    throw e
  }

  const portalUrl = `${baseUrl()}/p/${slug}`
  // Логин в сообщении родителю — сплошной номер (79991112233), без форматирования:
  // именно его вводят при входе, а +7 (999)… путает.
  const message =
    `Здравствуйте! Ваш личный кабинет центра «${org.name}»:\n` +
    `${portalUrl}\n` +
    `Логин: ${loginPhone}\n` +
    `Пароль: ${password}`

  return NextResponse.json({ loginPhone, password, portalUrl, message })
}

// DELETE /api/clients/[id]/portal-account — отключить доступ (сессии умирают
// через requirePortalAccount)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await loadContext(id)
  if ("error" in ctx) return ctx.error

  await db.clientPortalAccount.updateMany({
    where: { clientId: id, tenantId: ctx.org.id },
    data: { isActive: false },
  })
  return NextResponse.json({ ok: true })
}
