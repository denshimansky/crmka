import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { redirect } from "next/navigation"
import { branchScopeFromSession, type BranchScope } from "@/lib/branch-scope"

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
  return branchScopeFromSession(session.user.allowedBranchIds)
}
