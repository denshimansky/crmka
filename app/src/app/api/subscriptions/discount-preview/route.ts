import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { previewSubscriptionDiscount } from "@/lib/discounts/preview-discount"

// Read-only предпросчёт скидки для создаваемого абонемента (баг #72). Тип
// абонемента берём из настроек организации — единый источник, как в POST.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get("clientId")
  const lessonPrice = Number(searchParams.get("lessonPrice"))
  const totalLessons = Number(searchParams.get("totalLessons"))
  const periodYearRaw = searchParams.get("periodYear")
  const periodMonthRaw = searchParams.get("periodMonth")
  // Скидки v3: выбранный в форме шаблон ручной скидки (пусто/none → без ручной).
  const discountTemplateIdRaw = searchParams.get("discountTemplateId")
  const discountTemplateId =
    discountTemplateIdRaw && discountTemplateIdRaw !== "none" ? discountTemplateIdRaw : null

  if (!clientId || !Number.isFinite(lessonPrice) || !Number.isFinite(totalLessons)) {
    return NextResponse.json({ error: "Некорректные параметры" }, { status: 400 })
  }

  const org = await db.organization.findUnique({
    where: { id: session.user.tenantId },
    select: { subscriptionType: true },
  })
  const type = org?.subscriptionType === "package" ? "package" : "calendar"

  const preview = await previewSubscriptionDiscount(db, {
    tenantId: session.user.tenantId,
    clientId,
    type,
    periodYear: periodYearRaw != null ? Number(periodYearRaw) : null,
    periodMonth: periodMonthRaw != null ? Number(periodMonthRaw) : null,
    lessonPrice,
    totalLessons: Math.trunc(totalLessons),
    discountTemplateId,
  })

  // null — некорректный вход (нет клиента / нулевая цена): для формы это «без
  // предпросчёта», отдаём hasDiscount=false, чтобы UI показал обычную стоимость.
  return NextResponse.json(preview ?? { hasDiscount: false })
}
