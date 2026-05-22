import { ClientCardContent } from "../../_components/client-card-content"

export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ClientCardContent id={id} backHref="/crm/contacts" />
}
