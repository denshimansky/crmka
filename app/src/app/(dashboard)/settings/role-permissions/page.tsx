import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { PageHelp } from "@/components/page-help"
import { RolePermissionsMatrix } from "./role-permissions-matrix"
import { RoleDisplayNamesForm } from "../role-display-names-form"

export default async function RolePermissionsPage() {
  const session = await getSession()
  const isOwner = session.user.role === "owner"
  const org = await db.organization.findUnique({
    where: { id: session.user.tenantId },
    select: { roleDisplayNames: true },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Права ролей</h1>
        <PageHelp pageKey="settings/role-permissions" />
      </div>
      <p className="text-sm text-muted-foreground">
        Настройте, какие действия доступны каждой роли в вашей организации.
        Владелец всегда имеет полный доступ.
      </p>
      <RoleDisplayNamesForm
        initialValues={(org?.roleDisplayNames as Record<string, string>) ?? {}}
      />
      <RolePermissionsMatrix
        isOwner={isOwner}
        roleDisplayNames={(org?.roleDisplayNames as Record<string, string>) ?? {}}
      />
    </div>
  )
}
