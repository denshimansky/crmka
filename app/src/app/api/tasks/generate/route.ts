import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { generateTasksForTenant } from "@/lib/tasks/generate-tasks"

// POST /api/tasks/generate
// Ручная генерация автозадач для текущего тенанта (кнопка «Автозадачи» на /tasks).
// Та же логика крутится ежедневно по крону для всех тенантов
// (/api/cron/generate-tasks).
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const created = await generateTasksForTenant(session.user.tenantId)
  return NextResponse.json({ created })
}
