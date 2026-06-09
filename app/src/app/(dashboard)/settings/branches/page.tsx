import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PageHelp } from "@/components/page-help"
import { ArrowLeft, Building2, MapPin } from "lucide-react"
import Link from "next/link"
import { CreateBranchDialog } from "../create-branch-dialog"
import { CreateRoomDialog } from "../create-room-dialog"
import { EditBranchDialog } from "../edit-branch-dialog"
import { EditRoomDialog } from "../edit-room-dialog"

function pluralize(n: number, one: string, few: string, many: string) {
  const abs = Math.abs(n) % 100
  const lastDigit = abs % 10
  if (abs > 10 && abs < 20) return many
  if (lastDigit > 1 && lastDigit < 5) return few
  if (lastDigit === 1) return one
  return many
}

export default async function BranchesPage() {
  const session = await getSession()
  const isOwner = session.user.role === "owner"

  const org = await db.organization.findUnique({
    where: { id: session.user.tenantId },
    select: {
      branches: {
        where: { deletedAt: null },
        orderBy: { name: "asc" },
        include: { rooms: { where: { deletedAt: null } } },
      },
    },
  })

  const branches = org?.branches ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Филиалы</h1>
            <PageHelp pageKey="settings/branches" />
          </div>
          <p className="text-sm text-muted-foreground">
            Филиалы организации и залы внутри них
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Всего филиалов: {branches.length}</p>
        <div className="flex gap-2">
          <CreateRoomDialog branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
          <CreateBranchDialog />
        </div>
      </div>

      {branches.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет филиалов
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {branches.map((branch) => (
            <Card key={branch.id}>
              <CardContent className="relative p-5">
                {isOwner && (
                  <div className="absolute right-3 top-3">
                    <EditBranchDialog
                      branch={{
                        id: branch.id,
                        name: branch.name,
                        address: branch.address,
                        workingHoursStart: branch.workingHoursStart,
                        workingHoursEnd: branch.workingHoursEnd,
                        hasRooms: branch.rooms.length > 0,
                      }}
                    />
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Building2 className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1 pr-8">
                    <h3 className="truncate font-medium">{branch.name}</h3>
                    {branch.address && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" />
                        {branch.address}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="secondary">
                        {branch.rooms.length}{" "}
                        {pluralize(branch.rooms.length, "зал", "зала", "залов")}
                      </Badge>
                      {branch.workingHoursStart && branch.workingHoursEnd && (
                        <span className="text-xs text-muted-foreground">
                          {branch.workingHoursStart} — {branch.workingHoursEnd}
                        </span>
                      )}
                    </div>
                    {branch.rooms.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {branch.rooms.map((room) =>
                          isOwner ? (
                            <EditRoomDialog
                              key={room.id}
                              room={{
                                id: room.id,
                                name: room.name,
                                capacity: room.capacity,
                                branchId: branch.id,
                              }}
                              branches={branches.map((b) => ({ id: b.id, name: b.name }))}
                            />
                          ) : (
                            <Badge key={room.id} variant="outline" className="text-xs">
                              {room.name} ({room.capacity} чел.)
                            </Badge>
                          )
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
