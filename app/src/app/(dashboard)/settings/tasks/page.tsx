import { redirect } from "next/navigation"
import Link from "next/link"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import { PageHelp } from "@/components/page-help"
import {
  parseTriggerSettings,
  MANAGED_TRIGGERS,
  type TriggerSetting,
} from "@/lib/tasks/trigger-settings"
import { TaskTriggersForm } from "./task-triggers-form"

export default async function TaskTriggersPage() {
  const session = await getSession()
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    redirect("/settings")
  }

  const org = await db.organization.findUnique({
    where: { id: session.user.tenantId },
    select: { taskTriggerSettings: true },
  })
  if (!org) redirect("/settings")

  const saved = parseTriggerSettings(org.taskTriggerSettings)
  const settings: TriggerSetting[] = MANAGED_TRIGGERS.map((t) => {
    const existing = saved.find((s) => s.trigger === t)
    return existing ?? { trigger: t, enabled: true, startDayOfMonth: null }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex-1 flex items-center gap-2">
          <h1 className="text-2xl font-bold">Автотриггеры задач</h1>
          <PageHelp pageKey="settings/tasks" />
        </div>
      </div>

      <TaskTriggersForm initial={settings} />
    </div>
  )
}
