import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PageHelp } from "@/components/page-help"
import { ArrowLeft } from "lucide-react"
import { BackButton } from "@/components/back-button"
import { CreateDirectionDialog } from "../create-direction-dialog"
import { EditDirectionDialog } from "../edit-direction-dialog"
import { ArchiveDirectionButton, RestoreDirectionButton } from "../direction-archive-buttons"
import { getDirectionIcon } from "@/lib/direction-icons"
import { getOrgUiSettings } from "@/lib/role-names"
import { currencySymbol } from "@/lib/currency"
import type { Direction } from "@prisma/client"

export default async function DirectionsPage() {
  const session = await getSession()
  const orgUi = await getOrgUiSettings(session.user.tenantId)
  const sym = currencySymbol(orgUi?.currency)

  const all = await db.direction.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { sortOrder: "asc" },
  })
  const directions = all.filter((d) => d.deletedAt == null)
  const archived = all.filter((d) => d.deletedAt != null)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </BackButton>
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

      <div className="flex flex-wrap items-center justify-between gap-y-2">
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
          {directions.map((dir) => (
            <DirectionCard key={dir.id} dir={dir} sym={sym} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div className="space-y-3 pt-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Архив ({archived.length})
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {archived.map((dir) => (
              <DirectionCard key={dir.id} dir={dir} sym={sym} archived />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DirectionCard({ dir, sym, archived = false }: { dir: Direction; sym: string; archived?: boolean }) {
  const DirIcon = getDirectionIcon(dir.icon)
  return (
    <Card className={archived ? "opacity-70" : undefined}>
      <CardContent className="relative p-5">
        <div className="absolute right-3 top-3 flex items-center gap-0.5">
          {archived ? (
            <RestoreDirectionButton id={dir.id} />
          ) : (
            <>
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
                  packagePrices: (dir.packagePrices as Record<string, number> | null) ?? null,
                }}
              />
              <ArchiveDirectionButton id={dir.id} name={dir.name} />
            </>
          )}
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
                Цена: <span className="font-medium text-foreground">{Number(dir.lessonPrice).toLocaleString("ru-RU")} {sym}</span>
              </p>
              <p>
                Длительность: <span className="font-medium text-foreground">{dir.lessonDuration} мин.</span>
              </p>
              <p>
                Стоимость пробного:{" "}
                {dir.trialFree ? (
                  <Badge variant="secondary" className="ml-1">Бесплатно</Badge>
                ) : dir.trialPrice ? (
                  <span className="font-medium text-foreground">{Number(dir.trialPrice).toLocaleString("ru-RU")} {sym}</span>
                ) : (
                  <span className="italic">не задана</span>
                )}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
