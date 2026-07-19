import { redirect } from "next/navigation"
import { getCabinetSession, isValidWardKey } from "@/lib/portal-data"
import { VisitsList } from "./visits-list"

export default async function WardVisitsPage({
  params,
}: {
  params: Promise<{ slug: string; wardId: string }>
}) {
  const { slug, wardId } = await params
  const cabinet = await getCabinetSession(slug)
  if (!cabinet) redirect(`/p/${slug}`)
  if (!cabinet.gatePassed) return null

  const { tenantId, clientId } = cabinet.session
  if (!(await isValidWardKey(tenantId, clientId, wardId))) redirect(`/p/${slug}/cabinet`)

  return <VisitsList wardId={wardId} />
}
