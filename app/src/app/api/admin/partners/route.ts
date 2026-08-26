import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { monthlyPriceFor } from "@/lib/billing-price"
import {
  trialEndFromStart,
  anchorDayFromTrialEnd,
  toUtcDate,
} from "@/lib/billing/billing-schedule"
import { generateUniquePortalSlug } from "@/lib/portal-slug"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { isLoginTaken, LOGIN_TAKEN_MSG, uniqueViolationMessage } from "@/lib/employee-identity"
import { ensureSystemWithdrawalReasons } from "@/lib/withdrawal-reasons/seed-system-reasons"

// GET /api/admin/partners — список партнёров
export async function GET() {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const partners = await db.organization.findMany({
    include: {
      branches: { where: { deletedAt: null }, select: { id: true, name: true } },
      employees: { where: { role: "owner", deletedAt: null }, select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      billingSubscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { plan: { select: { name: true } } },
      },
      _count: {
        select: {
          employees: { where: { deletedAt: null } },
          clients: { where: { deletedAt: null } },
          branches: { where: { deletedAt: null } },
          directions: { where: { deletedAt: null } },
          aiChatLogs: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  // У Subscription нет relation на Organization (только колонка tenantId) —
  // активные абонементы считаем отдельным groupBy и подмешиваем в ответ.
  const activeSubs = await db.subscription.groupBy({
    by: ["tenantId"],
    where: { status: "active", deletedAt: null },
    _count: { _all: true },
  })
  const activeSubsByTenant = new Map(activeSubs.map((s) => [s.tenantId, s._count._all]))

  // Архивные партнёры (прекратили работу) уходят в конец списка; внутри групп —
  // сохраняем исходный порядок по дате создания (createdAt desc из запроса).
  const withCounts = partners.map((p) => ({ ...p, activeSubscriptions: activeSubsByTenant.get(p.id) ?? 0 }))
  withCounts.sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt))

  return NextResponse.json(withCounts)
}

const createSchema = z.object({
  name: z.string({ required_error: "Название обязательно" }).min(1, "Название обязательно"),
  legalName: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  inn: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  phone: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  email: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  contactPerson: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  // Owner — создаётся автоматически вместе с организацией
  ownerLastName: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  ownerFirstName: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  ownerLogin: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  ownerPassword: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  ownerEmail: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

// POST /api/admin/partners — создать партнёра (+ опционально owner)
export async function POST(req: NextRequest) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin" && session.role !== "billing") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const d = parsed.data

  // ИНН обязателен: без него невозможно выставлять счета и матчить оплату по
  // выписке (Bug #65 — тест не должен стартовать без реквизитов). 10 цифр (ЮЛ)
  // или 12 (ИП/физлицо).
  const innDigits = (d.inn || "").replace(/\D/g, "")
  if (innDigits.length !== 10 && innDigits.length !== 12) {
    return NextResponse.json(
      { error: "Укажите корректный ИНН партнёра (10 или 12 цифр) — без него невозможно выставлять счета" },
      { status: 400 }
    )
  }

  // Уникальность ЛОГИНА владельца — глобально, ДО создания организации, иначе при
  // конфликте останется осиротевшая org (прежняя проверка шла по org.id только
  // что созданной пустой орг → не срабатывала никогда — дыра). Email — уникален в
  // рамках центра, а орг ещё пуста, поэтому здесь проверять нечего.
  if (d.ownerLogin && (await isLoginTaken(db, d.ownerLogin))) {
    return NextResponse.json({ error: LOGIN_TAKEN_MSG }, { status: 409 })
  }

  // Слаг ЛК и тариф читаем до транзакции. Организацию, владельца и подписку
  // создаём АТОМАРНО: иначе гонка на глобальном unique-индексе логина (P2002 на
  // вставке владельца между isLoginTaken и create) оставляла бы осиротевшую орг.
  const portalSlug = await generateUniquePortalSlug(d.name)
  const defaultPlan = await db.billingPlan.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } })

  let org, owner
  try {
    ;({ org, owner } = await db.$transaction(async (tx) => {
      const createdOrg = await tx.organization.create({
        data: {
          name: d.name,
          legalName: d.legalName,
          inn: innDigits,
          phone: d.phone,
          email: d.email,
          contactPerson: d.contactPerson,
          portalSlug,
        },
      })

      let createdOwner = null
      if (d.ownerLogin && d.ownerPassword && d.ownerFirstName && d.ownerLastName) {
        createdOwner = await tx.employee.create({
          data: {
            tenantId: createdOrg.id,
            login: d.ownerLogin.trim(),
            passwordHash: bcrypt.hashSync(d.ownerPassword, 10),
            firstName: d.ownerFirstName,
            lastName: d.ownerLastName,
            email: d.ownerEmail,
            role: "owner",
          },
        })
      }

      // Подписка «Стандарт»: 14-дневный тест (старт = сегодня, срок первой оплаты
      // = конец теста, далее — индивидуальный день-якорь, Bug #65).
      if (defaultPlan) {
        const start = toUtcDate(new Date())
        const trialEnd = trialEndFromStart(start)
        await tx.billingSubscription.create({
          data: {
            organizationId: createdOrg.id,
            planId: defaultPlan.id,
            branchCount: 1,
            monthlyAmount: monthlyPriceFor(defaultPlan, 1),
            status: "trial",
            startDate: start,
            trialEndsAt: trialEnd,
            billingAnchorDay: anchorDayFromTrialEnd(trialEnd),
            nextPaymentDate: trialEnd,
          },
        })
      }

      return { org: createdOrg, owner: createdOwner }
    }))
  } catch (e) {
    const msg = uniqueViolationMessage(e)
    if (msg) return NextResponse.json({ error: msg }, { status: 409 })
    throw e
  }

  // Дефолтный справочник причин отчисления — сразу при создании центра, чтобы он
  // был «со старта». Best-effort: орг уже создана и закоммичена, ошибка seeding
  // не должна валить ответ — набор всё равно досеется лениво при первом GET.
  try {
    await ensureSystemWithdrawalReasons(org.id)
  } catch {
    /* лениво добьётся в GET /api/withdrawal-reasons */
  }

  return NextResponse.json({ ...org, owner: owner ? { id: owner.id, login: owner.login } : null }, { status: 201 })
}
