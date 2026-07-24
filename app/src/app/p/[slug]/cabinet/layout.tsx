import { redirect } from "next/navigation"
import { getCabinetSession, getLatestConsents, getPortalWards, SELF_WARD_KEY } from "@/lib/portal-data"
import { PORTAL_CONSENTS, effectiveRequiredTypes } from "@/lib/portal-consents"
import { ConsentGate, type GateItem } from "./_components/consent-gate"
import { PortalHeader } from "./_components/portal-header"
import { BottomNav } from "./_components/bottom-nav"

// Кабинет родителя: RSC-guard (сессия + учётка + слаг↔тенант), гейт согласий
// вместо содержимого, пока обязательные согласия не даны.

export default async function CabinetLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const cabinet = await getCabinetSession(slug)
  if (!cabinet) redirect(`/p/${slug}`)
  const { session, org, gatePassed } = cabinet

  if (!gatePassed) {
    const latest = await getLatestConsents(session.tenantId, session.clientId)
    const requiredTypes = new Set(effectiveRequiredTypes(org))
    const items: GateItem[] = PORTAL_CONSENTS.filter((c) => org[c.orgField]).map((c) => ({
      type: c.type,
      url: org[c.orgField] as string,
      required: c.required,
      prefix: c.gatePrefix,
      linkLabel: c.gateLink,
      suffix: c.gateSuffix || null,
      granted: latest.get(c.type)?.granted || false,
    }))
    // Fallback: ни один обязательный документ не заполнен — простое согласие ПДн
    const fallbackMode = items.filter((i) => i.required).length === 0 && requiredTypes.has("pdn_parent")

    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-8">
        <ConsentGate orgName={org.name} inn={org.inn} items={items} fallbackMode={fallbackMode} />
      </div>
    )
  }

  const { wards, hasSelfProfile } = await getPortalWards(session.tenantId, session.clientId)
  const defaultWardKey = wards[0]?.id ?? (hasSelfProfile ? SELF_WARD_KEY : null)

  return (
    <>
      <PortalHeader
        slug={slug}
        orgName={org.name}
        clientName={session.clientName}
        defaultWardKey={defaultWardKey}
      />
      <main className="mx-auto max-w-md px-4 pb-24 pt-4 md:max-w-4xl md:pb-12 md:pt-6">
        {children}
      </main>
      <BottomNav slug={slug} defaultWardKey={defaultWardKey} />
    </>
  )
}
