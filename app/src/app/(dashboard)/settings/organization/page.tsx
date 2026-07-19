import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { PageHelp } from "@/components/page-help"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { ParentPortalSettingsForm } from "./parent-portal-settings-form"

export default async function OrganizationInfoPage() {
  const session = await getSession()
  const org = await db.organization.findUnique({
    where: { id: session.user.tenantId },
    select: {
      name: true,
      legalName: true,
      inn: true,
      phone: true,
      email: true,
      portalSlug: true,
      portalOfferUrl: true,
      portalPrivacyPolicyUrl: true,
      portalPdnParentConsentUrl: true,
      portalPdnChildConsentUrl: true,
      portalPdnDistributionConsentUrl: true,
      portalMarketingConsentUrl: true,
    },
  })

  const canEditPortal = session.user.role === "owner" || session.user.role === "manager"
  const branches = canEditPortal
    ? await db.branch.findMany({
        where: { tenantId: session.user.tenantId, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          contactPhone: true,
          contactWhatsapp: true,
          contactTelegram: true,
          contactMax: true,
        },
      })
    : []

  const baseUrl = process.env.NEXTAUTH_URL || "https://app.umnayacrm.ru"

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Информация об организации</h1>
            <PageHelp pageKey="settings/organization" />
          </div>
          <p className="text-sm text-muted-foreground">
            Реквизиты юрлица, контакты для счетов и общения с клиентом
          </p>
        </div>
      </div>

      <Card className="max-w-2xl">
        <CardContent className="p-6">
          {org ? (
            <div className="space-y-4">
              <InfoRow label="Название" value={org.name} />
              <InfoRow label="Юрлицо" value={org.legalName} />
              <InfoRow label="ИНН" value={org.inn} />
              <InfoRow label="Телефон" value={org.phone} />
              <InfoRow label="Email" value={org.email} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Организация не найдена</p>
          )}
        </CardContent>
      </Card>

      {org && canEditPortal && (
        <ParentPortalSettingsForm
          portalSlug={org.portalSlug}
          docs={{
            portalOfferUrl: org.portalOfferUrl,
            portalPrivacyPolicyUrl: org.portalPrivacyPolicyUrl,
            portalPdnParentConsentUrl: org.portalPdnParentConsentUrl,
            portalPdnChildConsentUrl: org.portalPdnChildConsentUrl,
            portalPdnDistributionConsentUrl: org.portalPdnDistributionConsentUrl,
            portalMarketingConsentUrl: org.portalMarketingConsentUrl,
          }}
          branches={branches}
          isOwner={session.user.role === "owner"}
          baseUrl={baseUrl}
        />
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value || "---"}</span>
    </div>
  )
}
