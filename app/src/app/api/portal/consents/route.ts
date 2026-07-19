import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { getPortalSession, requirePortalAccount } from "@/lib/portal-auth"
import {
  PORTAL_CONSENTS,
  docUrlFor,
  effectiveRequiredTypes,
} from "@/lib/portal-consents"
import { getLatestConsents, PORTAL_ORG_DOCS_SELECT } from "@/lib/portal-data"
import { getClientIp } from "@/lib/rate-limit"

const consentTypeSchema = z.enum([
  "offer",
  "privacy_policy",
  "pdn_parent",
  "pdn_child",
  "pdn_distribution",
  "marketing",
])

const bodySchema = z.object({
  consents: z.array(z.object({ type: consentTypeSchema, granted: z.boolean() })).min(1),
})

async function requireSession() {
  const session = await getPortalSession()
  if (!session) return null
  const account = await requirePortalAccount(session)
  if (!account) return null
  return session
}

// GET /api/portal/consents — состояние гейта для клиентских компонентов
export async function GET() {
  const session = await requireSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const org = await db.organization.findUnique({
    where: { id: session.tenantId },
    select: { name: true, inn: true, ...PORTAL_ORG_DOCS_SELECT },
  })
  if (!org) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const latest = await getLatestConsents(session.tenantId, session.clientId)
  const requiredTypes = effectiveRequiredTypes(org)
  const consents = Object.fromEntries(
    [...latest.entries()].map(([type, state]) => [
      type,
      { granted: state.granted, createdAt: state.createdAt.toISOString() },
    ])
  )
  const docs = Object.fromEntries(PORTAL_CONSENTS.map((c) => [c.type, org[c.orgField]]))

  return NextResponse.json({
    organization: { name: org.name, inn: org.inn },
    docs,
    consents,
    requiredTypes,
    allRequiredGiven: requiredTypes.every((type) => latest.get(type)?.granted),
  })
}

// POST /api/portal/consents — записать согласия (гейт или переключатели кабинета)
export async function POST(req: NextRequest) {
  const session = await requireSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 })
  }

  // Обязательные согласия отозвать нельзя (гейт их только даёт)
  const requiredSet = new Set(PORTAL_CONSENTS.filter((c) => c.required).map((c) => c.type))
  for (const item of parsed.data.consents) {
    if (!item.granted && requiredSet.has(item.type)) {
      return NextResponse.json(
        { error: "Обязательное согласие нельзя отозвать из кабинета" },
        { status: 400 }
      )
    }
  }

  const org = await db.organization.findUnique({
    where: { id: session.tenantId },
    select: PORTAL_ORG_DOCS_SELECT,
  })
  if (!org) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const ipAddress = getClientIp(req)
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) || null

  await db.clientConsent.createMany({
    data: parsed.data.consents.map((item) => ({
      tenantId: session.tenantId,
      clientId: session.clientId,
      type: item.type,
      granted: item.granted,
      documentUrl: docUrlFor(org, item.type),
      ipAddress,
      userAgent,
      source: "portal",
    })),
  })

  return NextResponse.json({ ok: true })
}
