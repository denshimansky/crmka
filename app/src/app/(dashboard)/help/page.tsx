import { MarkdownGuide } from "@/components/markdown-guide"
import { PageHelp } from "@/components/page-help"
import { gettingStartedGuide } from "@/lib/getting-started-guide"

export const metadata = {
  title: "Справка — Умная CRM",
}

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Справка</h1>
        <PageHelp pageKey="help" />
      </div>
      <p className="text-sm text-muted-foreground">
        Руководство по первоначальной настройке центра и ежедневной работе в
        системе. Откройте нужный раздел через содержание ниже.
      </p>
      <MarkdownGuide source={gettingStartedGuide} />
    </div>
  )
}
