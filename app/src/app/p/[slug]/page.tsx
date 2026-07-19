import { notFound, redirect } from "next/navigation"
import { getPortalOrgBySlug, getCabinetSession } from "@/lib/portal-data"
import { LoginForm } from "./_components/login-form"

// Страница входа в ЛК родителя. При живой сессии этого центра — сразу в кабинет.

export default async function PortalLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const { slug } = await params
  const { from } = await searchParams

  const org = await getPortalOrgBySlug(slug)
  if (!org) notFound()

  const cabinet = await getCabinetSession(slug)
  if (cabinet) redirect(`/p/${slug}/cabinet`)

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-8">
      <LoginForm slug={slug} orgName={org.name} fromLegacy={from === "legacy"} />
    </div>
  )
}
