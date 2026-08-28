import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { resolveBranchScope } from "@/lib/session"
import { isUnscoped } from "@/lib/branch-scope"
import { loadContactRows, parseTab } from "@/lib/clients/contacts-query"

/**
 * GET /api/clients/contacts-export — строки активной вкладки «Клиенты» для
 * выгрузки в Excel. Файл собирает браузер (тем же exportToExcel, что и отчёты),
 * здесь только данные.
 *
 * ТОЛЬКО ВЛАДЕЛЕЦ: выгрузка отдаёт клиентскую базу одним файлом, поэтому гейт
 * настоящий — на сервере, а не спрятанная кнопка. Остальным ролям 403, даже
 * если они позовут эндпоинт руками.
 *
 * Фильтры (вкладка, поиск, филиал) приходят те же, что в URL страницы, и
 * прогоняются через ТОТ ЖЕ loadContactRows — файл не может разойтись с экраном.
 * Филиальный scope сессии применяется поверх (владелец обычно не ограничен, но
 * правило общее для всех поверхностей).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role !== "owner") {
    return NextResponse.json(
      { error: "Выгрузка клиентской базы доступна только владельцу" },
      { status: 403 },
    )
  }

  const tenantId = session.user.tenantId
  const scope = await resolveBranchScope(tenantId, session.user.allowedBranchIds)

  const { searchParams } = new URL(req.url)
  const tab = parseTab(searchParams.get("tab"))
  const query = (searchParams.get("q") ?? "").trim()
  const rawBranch = searchParams.get("branchId")
  const branch = rawBranch && rawBranch !== "all" ? rawBranch : null
  // Филиал из URL пересекается со scope сессии — как на самой странице.
  const branchFilter = branch && (isUnscoped(scope) || scope.branchIds.includes(branch)) ? branch : null

  const rows = await loadContactRows({
    tenantId,
    scope,
    tab,
    query,
    branchFilter,
    role,
    instructorsSeePhones: session.user.instructorsSeePhones,
  })

  return NextResponse.json({ rows })
}
