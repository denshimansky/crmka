import { redirect } from "next/navigation"
import Link from "next/link"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import { PageHelp } from "@/components/page-help"
import { SecurityForm } from "./security-form"

export default async function SecuritySettingsPage() {
  const session = await getSession()
  if (session.user.role !== "owner") redirect("/settings")

  const org = await db.organization.findUnique({
    where: { id: session.user.tenantId },
    select: { hidePhonesFromInstructors: true, restrictClientExport: true },
  })
  if (!org) redirect("/settings")

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex-1 flex items-center gap-2">
          <h1 className="text-2xl font-bold">Безопасность данных</h1>
          <PageHelp pageKey="settings/security" />
        </div>
      </div>

      <SecurityForm
        initial={{
          hidePhonesFromInstructors: org.hidePhonesFromInstructors,
          restrictClientExport: org.restrictClientExport,
        }}
      />
    </div>
  )
}
