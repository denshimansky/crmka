import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { syncBalances } from "@/lib/leads-import/sync-balances"

export const runtime = "nodejs"
export const maxDuration = 60

// POST /api/leads-import/sync-balances — точечная синхронизация Client.clientBalance
// по файлу формата «остатки.xlsx». НЕ создаёт клиентов, НЕ пишет в ДДС.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "owner") {
    return NextResponse.json(
      { error: "Только владелец может выполнять синхронизацию остатков" },
      { status: 403 },
    )
  }

  const formData = await req.formData()
  const balancesFile = formData.get("balancesFile") as File | null
  if (!balancesFile) {
    return NextResponse.json({ error: "Не выбран файл «остатки.xlsx»" }, { status: 400 })
  }

  const buffer = Buffer.from(await balancesFile.arrayBuffer())

  let result
  try {
    result = await syncBalances({
      buffer,
      tenantId: session.user.tenantId,
      createdBy: session.user.employeeId ?? null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          "В файле не найдено ни одной строки с заполненными «Телефон» и «Баланс на сегодня». " +
          "Проверьте шапку и значения.",
        detectedHeaders: result.detectedHeaders,
      },
      { status: 400 },
    )
  }

  return NextResponse.json({
    rowsParsed: result.rowsParsed,
    rowsSkippedNoPhone: result.rowsSkippedNoPhone,
    rowsSkippedNoBalance: result.rowsSkippedNoBalance,
    phonesTotal: result.phonesTotal,
    matched: result.matched,
    updated: result.updated,
    unchanged: result.unchanged,
    missingInDb: result.missingInDb,
    updatedClients: result.updatedClients,
    totalTargetSum: result.totalTargetSum,
    totalDeltaApplied: result.totalDeltaApplied,
  })
}
