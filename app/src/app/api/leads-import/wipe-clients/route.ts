import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isWipeAvailable } from "@/lib/leads-import/sync-leads"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/leads-import/wipe-clients
// Сносит всю клиентскую базу тенанта. Разрешено только когда:
//   1) текущая сессия — суперадмин под impersonation роли owner (не настоящий владелец);
//   2) был успешный leads_import_sync в последние 7 дней.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const impersonatedBy = (session.user as unknown as { impersonatedBy?: string }).impersonatedBy
  if (!impersonatedBy) {
    return NextResponse.json(
      { error: "Очистка доступна только суперадмину в режиме «Войти как партнёр»." },
      { status: 403 },
    )
  }
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const tenantId = session.user.tenantId

  const gate = await isWipeAvailable(tenantId)
  if (!gate.available) {
    return NextResponse.json(
      {
        error: gate.importedAt
          ? `Окно для очистки истекло ${gate.expiresAt?.toLocaleString("ru-RU")}. Дальше — только через техподдержку.`
          : "Очистка доступна только в течение 7 дней после первого импорта.",
      },
      { status: 403 },
    )
  }

  // Подтверждение: клиент должен прислать в body точное имя организации.
  const body = await req.json().catch(() => ({}))
  const confirmation: string = body?.confirmation ?? ""
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { name: true },
  })
  if (!org) {
    return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })
  }
  if (confirmation.trim() !== org.name.trim()) {
    return NextResponse.json(
      { error: "Подтверждение не совпадает с названием организации. Удаление отменено." },
      { status: 400 },
    )
  }

  // Считаем "до" — для отчёта.
  const before = await db.client.count({ where: { tenantId, deletedAt: null } })

  // Удаляем в правильном порядке. Только клиентские данные тенанта — оргструктура,
  // справочники, расписание, финансовые счета и расходы остаются.
  const w = { tenantId } // common filter
  await db.$transaction([
    db.callCampaignItem.deleteMany({ where: w }),
    db.callCampaign.deleteMany({ where: w }),
    db.communication.deleteMany({ where: w }),
    db.clientBalanceTransaction.deleteMany({ where: w }),
    db.clientPortalToken.deleteMany({ where: w }),
    db.application.deleteMany({ where: w }),
    db.trialLesson.deleteMany({ where: w }),
    db.attendance.deleteMany({ where: w }),
    db.discount.deleteMany({ where: w }),
    db.payment.deleteMany({ where: w }),
    db.unprolongedComment.deleteMany({ where: w }),
    db.subscription.deleteMany({ where: w }),
    db.groupEnrollment.deleteMany({ where: w }),
    db.task.deleteMany({ where: { tenantId, clientId: { not: null } } }),
    db.ward.deleteMany({ where: w }),
    db.client.deleteMany({ where: w }),
    db.auditLog.create({
      data: {
        tenantId,
        employeeId: session.user.employeeId,
        action: "wipe_client_database",
        entityType: "system",
        entityId: tenantId,
        changes: {
          deletedClients: before,
          impersonatedBy,
          confirmedAs: confirmation.trim(),
        },
      },
    }),
  ])

  return NextResponse.json({
    ok: true,
    deletedClients: before,
    message: `Удалено клиентов: ${before}. Расписание, сотрудники и справочники сохранены.`,
  })
}
