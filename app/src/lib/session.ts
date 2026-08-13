import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { redirect } from "next/navigation"
import { branchScopeFromSession, type BranchScope } from "@/lib/branch-scope"
import { db } from "@/lib/db"

export async function getSession() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect("/login")
  return session
}

export async function getTenantId() {
  const session = await getSession()
  return session.user.tenantId
}

// Возвращает scope филиалов для текущей сессии (ADM-04).
// Используется в WHERE-условиях Prisma-запросов на серверной стороне.
export async function getBranchScope(): Promise<BranchScope> {
  const session = await getSession()
  const scope = branchScopeFromSession(session.user.allowedBranchIds)
  if (scope.mode !== "limited" || scope.branchIds.length === 0) return scope
  // Покрывает ли scope ВСЕ (не удалённые) филиалы тенанта? Тогда для видимости
  // клиентов он = «видит всех», включая безфилиальных (решение владельца
  // 13.08.2026): админ с отмеченными всеми филиалами видит и клиентов без
  // проставленного филиала. Прочие scope-функции игнорируют флаг (жёстко по ids).
  const missing = await db.branch.count({
    where: {
      tenantId: session.user.tenantId,
      deletedAt: null,
      id: { notIn: scope.branchIds },
    },
  })
  return { ...scope, coversAllBranches: missing === 0 }
}
