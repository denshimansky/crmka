import Link from "next/link"
import { ShieldOff } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export function AccessDenied() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldOff className="size-7" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Раздел недоступен</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              У вашей роли нет прав на этот раздел. Запросите доступ у владельца.
            </p>
          </div>
          <Button render={<Link href="/" />}>Вернуться на главную</Button>
        </CardContent>
      </Card>
    </div>
  )
}
