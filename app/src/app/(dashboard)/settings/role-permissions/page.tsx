import { getSession } from "@/lib/session"
import { PageHelp } from "@/components/page-help"
import { RolePermissionsMatrix } from "./role-permissions-matrix"

export default async function RolePermissionsPage() {
  const session = await getSession()
  const isOwner = session.user.role === "owner"

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
      <RolePermissionsMatrix isOwner={isOwner} />
    </div>
  )
}
