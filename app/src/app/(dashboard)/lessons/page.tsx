import Link from "next/link"
import { UserX, ClipboardCheck } from "lucide-react"
import { PageHelp } from "@/components/page-help"
import { Card, CardContent } from "@/components/ui/card"

interface Tile {
  href: string
  title: string
  description: string
  icon: typeof UserX
}

const tiles: Tile[] = [
  {
    href: "/lessons/absences",
    title: "Пропуски",
    description: "Реестр неявок и неотмеченных посещений за период",
    icon: UserX,
  },
  {
    href: "/lessons/attendance",
    title: "Посещения",
    description: "Сетка посещений по группам и дням месяца",
    icon: ClipboardCheck,
  },
]

export default function LessonsPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Занятия</h1>
          <PageHelp pageKey="lessons" />
        </div>
        <p className="text-sm text-muted-foreground">
          Отчёты и реестры по проведённым занятиям
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => {
          const Icon = tile.icon
          return (
            <Link key={tile.href} href={tile.href} className="block">
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </div>
                  <div>
                    <p className="font-semibold">{tile.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {tile.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
