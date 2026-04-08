import { Card, CardContent } from "@/components/ui/card"
import { PageHelp } from "@/components/page-help"

export default function Page() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Склад</h1>
        <PageHelp pageKey="stock" />
      </div>
      <Card>
        <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
          Раздел в разработке
        </CardContent>
      </Card>
    </div>
  )
}
