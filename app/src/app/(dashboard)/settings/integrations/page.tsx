import { getSession } from "@/lib/session"
import { IntegrationsContent } from "./integrations-content"

export default async function IntegrationsPage() {
  const session = await getSession()

  return <IntegrationsContent tenantId={session.user.tenantId} />
}
