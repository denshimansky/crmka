import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PageHelp } from "@/components/page-help"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { CreateDirectionDialog } from "../create-direction-dialog"
import { EditDirectionDialog } from "../edit-direction-dialog"
import { getDirectionIcon } from "@/lib/direction-icons"

export default async function DirectionsPage() {
  const session = await getSession()

  const org = await db.organization.findUnique({
    where: { id: session.user.tenantId },
    select: {
      directions: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
      },
    },
  })

  const directions = org?.directions ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Направления</h1>
            <PageHelp pageKey="settings/directions" />
          </div>
          <p className="text-sm text-muted-foreground">
            Услуги центра: цена занятия, длительность, цена пробного
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Всего направлений: {directions.length}
        </p>
        <CreateDirectionDialog />
      </div>

      {directions.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет направлений
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {directions.map((dir) => {
            const DirIcon = getDirectionIcon(dir.icon)
            return (
              <Card key={dir.id}>
                <CardContent className="relative p-5">
                  <div className="absolute right-3 top-3">
                    <EditDirectionDialog
                      direction={{
                        id: dir.id,
                        name: dir.name,
                        lessonPrice: String(dir.lessonPrice),
                        lessonDuration: dir.lessonDuration,
                        trialPrice: dir.trialPrice ? String(dir.trialPrice) : null,
                        trialFree: dir.trialFree,
                        singleVisitPrice: dir.singleVisitPrice ? String(dir.singleVisitPrice) : null,
                        color: dir.color,
                        icon: dir.icon,
                      }}
                    />
                  </div>
                  <div className="flex items-start gap-3">
                    <div
                      className="flex size-10 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        backgroundColor: dir.color ? `${dir.color}20` : undefined,
                        color: dir.color ?? undefined,
                      }}
                    >
                      <DirIcon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-medium">{dir.name}</h3>
                      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                        <p>
                          Цена: <span className="font-medium text-foreground">{Number(dir.lessonPrice).toLocaleString("ru-RU")} ₽</span>
                        </p>
                        <p>
                          Длительность: <span className="font-medium text-foreground">{dir.lessonDuration} мин.</span>
                        </p>
                        {dir.trialFree ? (
                          <p>
                            Пробное: <Badge variant="secondary" className="ml-1">Бесплатно</Badge>
                          </p>
                        ) : dir.trialPrice ? (
                          <p>
                            Пробное: <span className="font-medium text-foreground">{Number(dir.trialPrice).toLocaleString("ru-RU")} ₽</span>
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
