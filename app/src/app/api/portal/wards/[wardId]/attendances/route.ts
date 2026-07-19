import { NextRequest, NextResponse } from "next/server"
import { getPortalContext, getWardAttendances, isValidWardKey } from "@/lib/portal-data"

// GET /api/portal/wards/[wardId]/attendances?offset= — посещения подопечного
// (wardId = id подопечного либо "self")
export async function GET(req: NextRequest, { params }: { params: Promise<{ wardId: string }> }) {
  const ctx = await getPortalContext()
  if (!ctx.ok) {
    return NextResponse.json({ error: "Forbidden", code: ctx.code }, { status: ctx.status })
  }

  const { wardId } = await params
  const { tenantId, clientId } = ctx.session
  if (!(await isValidWardKey(tenantId, clientId, wardId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset")) || 0)
  const result = await getWardAttendances(tenantId, clientId, wardId, { offset })
  return NextResponse.json(result)
}
