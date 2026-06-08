import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHelp } from "@/components/page-help"
import { parseSegmentationConfig } from "@/lib/segmentation"
import { SegmentationForm } from "./segmentation-form"

export default async function SegmentationSettingsPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { segmentationConfig: true },
  })
  const initial = parseSegmentationConfig(org?.segmentationConfig)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/settings?tab=refs"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ChevronLeft className="size-4" />
          Назад в Справочники
        </Link>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Сегментация клиентов</h1>
          <PageHelp pageKey="settings/segmentation" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Владелец задаёт пороги, по которым активный клиент попадает в один из
          четырёх сегментов: «Новый», «Стандартный», «Постоянный», «VIP». Сегмент
          показывается в шапке карточки клиента и в таблице «Активные».
        </p>
      </div>


      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Конфигурация</CardTitle>
        </CardHeader>
        <CardContent>
          <SegmentationForm initial={initial} />
        </CardContent>
      </Card>
    </div>
  )
}
