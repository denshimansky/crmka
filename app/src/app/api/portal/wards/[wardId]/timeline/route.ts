import { NextRequest, NextResponse } from "next/server"
import { getPortalContext, getWardTimeline, isValidWardKey } from "@/lib/portal-data"

// GET /api/portal/wards/[wardId]/timeline — история подопечного
// (wardId = id подопечного либо "self")
export async function GET(_req: NextRequest, { params }: { params: Promise<{ wardId: string }> }) {
  const ctx = await getPortalContext()
  if (!ctx.ok) {
    return NextResponse.json({ error: "Forbidden", code: ctx.code }, { status: ctx.status })
  }

  const { wardId } = await params
  const { tenantId, clientId } = ctx.session
  if (!(await isValidWardKey(tenantId, clientId, wardId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const events = await getWardTimeline(tenantId, clientId, wardId)
  return NextResponse.json({ items: events })
}
