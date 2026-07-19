import { redirect } from "next/navigation"
import { getCabinetSession, getPortalWards, isValidWardKey, SELF_WARD_KEY } from "@/lib/portal-data"
import { formatWardName } from "@/lib/format-name"
import { WardSwitcher } from "./ward-switcher"

// Разрез подопечного: проверка принадлежности + переключатель детей.

export default async function WardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string; wardId: string }>
}) {
  const { slug, wardId } = await params
  const cabinet = await getCabinetSession(slug)
  if (!cabinet) redirect(`/p/${slug}`)
  if (!cabinet.gatePassed) return null

  const { tenantId, clientId } = cabinet.session
  if (!(await isValidWardKey(tenantId, clientId, wardId))) {
    redirect(`/p/${slug}/cabinet`)
  }

  const { wards, hasSelfProfile } = await getPortalWards(tenantId, clientId)
  const chips = [
    ...wards.map((w) => ({ key: w.id, label: formatWardName(w) })),
    ...(hasSelfProfile ? [{ key: SELF_WARD_KEY, label: "Я" }] : []),
  ]

  return (
    <div className="space-y-4">
      {chips.length > 1 && <WardSwitcher slug={slug} chips={chips} />}
      {children}
    </div>
  )
}
