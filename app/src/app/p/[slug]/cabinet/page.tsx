import { redirect } from "next/navigation"
import { getCabinetSession, getPortalWards, SELF_WARD_KEY } from "@/lib/portal-data"

// Корень кабинета: редирект в разрез первого подопечного (или «Я» для данных
// без подопечного). Пусто — приветственный экран.

export default async function CabinetIndexPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const cabinet = await getCabinetSession(slug)
  if (!cabinet) redirect(`/p/${slug}`)
  if (!cabinet.gatePassed) return null

  const { wards, hasSelfProfile } = await getPortalWards(
    cabinet.session.tenantId,
    cabinet.session.clientId
  )
  const defaultWardKey = wards[0]?.id ?? (hasSelfProfile ? SELF_WARD_KEY : null)
  if (defaultWardKey) redirect(`/p/${slug}/cabinet/w/${defaultWardKey}`)

  return (
    <div className="py-16 text-center text-sm text-muted-foreground">
      Здесь появится информация о занятиях, абонементах и посещениях.
      <br />
      Обратитесь к администратору вашего центра.
    </div>
  )
}
