import Link from "next/link"
import { ArrowLeft, ClipboardCheck } from "lucide-react"
import { PageHelp } from "@/components/page-help"
import { Card, CardContent } from "@/components/ui/card"

export default function LessonsAttendancePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/lessons" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Посещения</h1>
            <PageHelp pageKey="lessons/attendance" />
          </div>
          <p className="text-sm text-muted-foreground">Раздел в разработке</p>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
          <ClipboardCheck className="size-10 text-muted-foreground/50" />
          <p>Здесь появится сводная таблица посещений по группам и периодам.</p>
        </CardContent>
      </Card>
    </div>
  )
}
