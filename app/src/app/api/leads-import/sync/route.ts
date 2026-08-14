import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { requirePermission } from "@/lib/api-permissions"
import { syncLeads } from "@/lib/leads-import/sync-leads"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/leads-import/sync — импорт клиентов по заполненному шаблону
// «Шаблон импорта клиентов.xlsx» (лист «Клиенты») → контакты и балансы в БД.
export async function POST(req: NextRequest) {
  const guard = await requirePermission("clients.import")
  if (!guard.ok) return guard.response
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const formData = await req.formData()
  const leadsFile = formData.get("leadsFile") as File | null
  // Опциональный файл балансов сохраняем для обратной совместимости, но UI его
  // больше не отправляет — балансы приходят колонкой «Баланс» из шаблона.
  const moneyFile = formData.get("moneyFile") as File | null
  if (!leadsFile) {
    return NextResponse.json({ error: "Не выбран заполненный шаблон импорта клиентов" }, { status: 400 })
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
          "В шаблоне не найдено ни одной строки с заполненным ребёнком. " +
          "Проверьте, что на листе «Клиенты» шапка содержит колонку «Ребёнок» и есть строки данных.",
        detectedHeaders: result.detectedHeaders,
      },
      { status: 400 },
    )
  }
  if (!result.ok && result.reason === "no_contacts") {
    return NextResponse.json(
      {
        error:
          `Найдено ${result.rows.length} строк без телефона и без соцсетей. ` +
          "У каждой импортируемой строки должен быть заполнен телефон или соцсети — " +
          "иначе клиента нельзя найти и повторный импорт создаст дубли. " +
          "Исправьте таблицу и загрузите снова. Импорт не выполнен.",
        noContacts: result.rows,
      },
      { status: 422 },
    )
  }
  if (!result.ok && result.reason === "branch_not_found") {
    return NextResponse.json(
      {
        error:
          "В файле есть филиалы, которых нет в CRM. Создайте филиалы с такими же названиями " +
          "(Настройки → Филиалы) и запустите импорт снова. Импорт не выполнен.",
        branchNotFound: result.branches,
      },
      { status: 422 },
    )
  }
  if (!result.ok && result.reason === "active_not_allowed") {
    return NextResponse.json(
      {
        error:
          `Найдено ${result.rows.length} строк со статусом «Активный»/«Продажа». ` +
          "Импорт не заводит активных клиентов — активным клиент становится только после " +
          "выписки абонемента. Поменяйте у этих строк статус в файле (например, «Выбыл» " +
          "или «Потенциал») и загрузите снова. Импорт не выполнен.",
        activeStatus: result.rows,
      },
      { status: 422 },
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
    duplicateRowsCollapsed: result.duplicateRowsCollapsed,
    moneyParsed: result.moneyParsed,
    clientsCreated: result.clientsCreated,
    clientsMerged: result.clientsMerged,
    wardsCreated: result.wardsCreated,
    clientsCreatedWithoutPhone: result.clientsCreatedWithoutPhone,
    withoutPhone: result.withoutPhone,
    multiRowBalanceCount: result.multiRowBalanceCount,
    multiRowBalance: result.multiRowBalance,
    totalBalance: result.totalBalance,
    balanceMissing: result.balanceMissing,
    branchAssigned: result.branchAssigned,
    branchMissing: result.branchMissing,
    branchCorrected: result.branchCorrected,
    branchConflicts: result.branchConflicts,
    warnings: result.warnings,
  })
}
