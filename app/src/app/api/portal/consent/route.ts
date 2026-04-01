import { NextResponse } from "next/server"
import { getPortalSession, signPortalToken } from "@/lib/portal-auth"
import { db } from "@/lib/db"

// POST /api/portal/consent — согласие на обработку ПДн
export async function POST() {
  const session = await getPortalSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  await db.clientPortalToken.updateMany({
    where: { clientId: session.clientId, tenantId: session.tenantId, isActive: true },
    data: { pdnConsent: true, pdnConsentDate: new Date() },
  })

  // Обновляем JWT с pdnConsent = true
  const newPayload = { ...session, pdnConsent: true }
  const jwt = await signPortalToken(newPayload)

  const response = NextResponse.json({ ok: true })
  response.cookies.set("portal-token", jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  })

  return response
}
