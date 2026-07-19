import { notFound } from "next/navigation"
import { getPortalOrgBySlug } from "@/lib/portal-data"

// Публичный контур ЛК родителя: /p/<slug> — логин, /p/<slug>/cabinet — кабинет.
// Исключён из CRM-middleware (matcher), авторизация — своя (portal-token).

export default async function PortalSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const org = await getPortalOrgBySlug(slug)
  if (!org) notFound()

  return <div className="min-h-screen bg-muted/30">{children}</div>
}
