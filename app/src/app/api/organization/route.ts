import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { PORTAL_SLUG_REGEX } from "@/lib/portal-slug"

// URL-поле настроек: валидный URL, пустая строка = «очистить» (пишем null)
const portalUrlField = z
  .string()
  .url("Введите корректную ссылку (https://…)")
  .or(z.literal(""))
  .optional()

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  legalName: z.string().optional(),
  inn: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  salaryDay1: z.number().min(1).max(28).optional(),
  salaryDay2: z.number().min(1).max(31).optional(),
  payForAbsence: z.boolean().optional(),
  // Видят ли педагоги (instructor) телефоны клиентов
  instructorsSeePhones: z.boolean().optional(),
  attendanceDeadline: z.number().min(1).max(90).optional(),
  // Только известные роли, названия до 50 символов; trim и отбрасывание
  // пустых значений — при сохранении (пустое = «использовать дефолт»)
  roleDisplayNames: z
    .record(z.enum(["owner", "manager", "admin", "instructor", "readonly"]), z.string().max(50))
    .optional(),
  rolePermissions: z.record(z.record(z.boolean())).optional(),
  onboardingCompleted: z.boolean().optional(),
  subscriptionType: z.enum(["calendar", "fixed", "package"]).optional(),
  packageDefaultValidDays: z.number().int().min(1).max(3650).optional(),
  packageExpiryNotifyDaysBefore: z.number().int().min(0).max(60).optional(),
  // Кол-во дней до автозакрытия неоплаченного абонемента без посещений.
  // null = функция выключена; 0 — недопустимо (запретили бы сразу после создания).
  unpaidSubscriptionAutoCloseDays: z.number().int().min(1).max(365).nullable().optional(),
  // ЛК родителя: слаг ссылки /p/<slug> (латиница/цифры/дефис) и 6 внешних URL
  // юридических документов (см. lib/portal-consents.ts)
  portalSlug: z
    .string()
    .regex(PORTAL_SLUG_REGEX, "Слаг: 3–40 символов, латиница, цифры и дефис")
    .optional(),
  portalOfferUrl: portalUrlField,
  portalPrivacyPolicyUrl: portalUrlField,
  portalPdnParentConsentUrl: portalUrlField,
  portalPdnChildConsentUrl: portalUrlField,
  portalPdnDistributionConsentUrl: portalUrlField,
  portalMarketingConsentUrl: portalUrlField,
})

const PORTAL_URL_KEYS = [
  "portalOfferUrl",
  "portalPrivacyPolicyUrl",
  "portalPdnParentConsentUrl",
  "portalPdnChildConsentUrl",
  "portalPdnDistributionConsentUrl",
  "portalMarketingConsentUrl",
] as const

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await db.organization.findUnique({
    where: { id: session.user.tenantId },
    include: {
      branches: { where: { deletedAt: null }, include: { rooms: { where: { deletedAt: null } } } },
      _count: { select: { employees: true } },
    },
  })

  return NextResponse.json(org)
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Названия ролей: trim, пустые значения выбрасываем — пустое поле в форме
  // означает «использовать дефолтное название», а не хранить ""
  if (data.roleDisplayNames) {
    data.roleDisplayNames = Object.fromEntries(
      Object.entries(data.roleDisplayNames)
        .map(([role, name]) => [role, name.trim()])
        .filter(([, name]) => name !== ""),
    ) as typeof data.roleDisplayNames
  }

  // Пустая строка URL-поля документа = очистить (null)
  const portalData: Record<string, string | null> = {}
  for (const key of PORTAL_URL_KEYS) {
    if (data[key] !== undefined) portalData[key] = data[key] || null
  }

  // Слаг портала: меняет только владелец (смена ломает разосланные ссылки),
  // глобальная уникальность — понятная ошибка вместо P2002
  if (data.portalSlug !== undefined) {
    if (session.user.role !== "owner") {
      return NextResponse.json({ error: "Адрес кабинета может менять только владелец" }, { status: 403 })
    }
    const taken = await db.organization.findFirst({
      where: { portalSlug: data.portalSlug, id: { not: session.user.tenantId } },
      select: { id: true },
    })
    if (taken) {
      return NextResponse.json(
        { error: "Этот адрес кабинета уже занят другой организацией" },
        { status: 409 },
      )
    }
  }

  // Тип абонемента нельзя сменить после блокировки (= после создания первого абонемента).
  // Разблокировать может только техподдержка через backoffice.
  if (data.subscriptionType !== undefined) {
    if (session.user.role !== "owner") {
      return NextResponse.json({ error: "Тип абонемента может выбирать только владелец" }, { status: 403 })
    }
    const current = await db.organization.findUnique({
      where: { id: session.user.tenantId },
      select: { subscriptionType: true, subscriptionTypeLockedAt: true },
    })
    if (current?.subscriptionTypeLockedAt && current.subscriptionType !== data.subscriptionType) {
      return NextResponse.json(
        { error: "Тип абонемента заблокирован. Для смены обратитесь в техподдержку." },
        { status: 409 },
      )
    }
  }

  const org = await db.organization.update({
    where: { id: session.user.tenantId },
    data: { ...data, ...portalData },
  })

  return NextResponse.json(org)
}
