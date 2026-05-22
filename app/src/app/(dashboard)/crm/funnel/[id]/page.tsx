import { redirect } from "next/navigation"

export default async function FunnelClientRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/crm/clients/${id}`)
}
