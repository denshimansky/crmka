import { NextResponse } from "next/server"
import { requirePermission } from "@/lib/api-permissions"
import { generateTasksForTenant } from "@/lib/tasks/generate-tasks"

// POST /api/tasks/generate
// Ручная генерация автозадач для текущего тенанта (кнопка «Автозадачи» на /tasks).
// Та же логика крутится ежедневно по крону для всех тенантов
// (/api/cron/generate-tasks).
export async function POST() {
  // Управленческое действие: доступно тем, кто редактирует клиентов
  // (владелец/управляющий/администратор). Педагог кнопки не видит и API не может.
  const guard = await requirePermission("clients.edit")
  if (!guard.ok) return guard.response
  const session = guard.session! as { user: { tenantId: string } }

  const created = await generateTasksForTenant(session.user.tenantId)
  return NextResponse.json({ created })
}
