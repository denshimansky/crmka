import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { syncLeads } from "@/lib/leads-import/sync-leads"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/leads-import/sync — этап 2: промежуточный xlsx + деньги.xlsx → контакты в БД
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Только владелец может выполнять импорт" }, { status: 403 })
  }

  const formData = await req.formData()
  const leadsFile = formData.get("leadsFile") as File | null
  const moneyFile = formData.get("moneyFile") as File | null
  if (!leadsFile) {
    return NextResponse.json({ error: "Не выбран файл «Список лидов — для импорта.xlsx»" }, { status: 400 })
  }

  const leadsBuffer = Buffer.from(await leadsFile.arrayBuffer())
  const moneyBuffer = moneyFile ? Buffer.from(await moneyFile.arrayBuffer()) : null

  let result
  try {
    result = await syncLeads({
      leadsBuffer,
      moneyBuffer,
      tenantId: session.user.tenantId,
      createdBy: session.user.employeeId ?? null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  if (!result.ok && result.reason === "empty_leads") {
    return NextResponse.json(
      {
        error:
          "В файле «Список лидов — для импорта.xlsx» не найдено ни одной строки с заполненным ребёнком. " +
          "Проверьте, что шапка содержит колонку «Ребёнок» и есть строки данных.",
        detectedHeaders: result.detectedHeaders,
      },
      { status: 400 },
    )
  }
  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          `Найдены ${result.rows.length} строк с пометкой «Проверить = да». ` +
          "Исправьте их в файле и загрузите снова. Импорт не выполнен.",
        needsReview: result.rows,
      },
      { status: 422 },
    )
  }

  return NextResponse.json({
    leadsParsed: result.leadsParsed,
    moneyParsed: result.moneyParsed,
    clientsCreated: result.clientsCreated,
    clientsMerged: result.clientsMerged,
    wardsCreated: result.wardsCreated,
    totalBalance: result.totalBalance,
    balanceMissing: result.balanceMissing,
    warnings: result.warnings,
  })
}
