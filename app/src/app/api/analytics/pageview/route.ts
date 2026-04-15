import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// POST /api/analytics/pageview — записать просмотр страницы
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    const body = await req.json()
    const { path, duration } = body

    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path required" }, { status: 400 })
    }

    await db.pageView.create({
      data: {
        tenantId: session?.user?.tenantId || null,
        employeeId: session?.user?.employeeId || null,
        path: path.slice(0, 255),
        duration: typeof duration === "number" ? Math.round(duration) : null,
      },
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true }) // не ломаем UX при ошибке аналитики
  }
}
