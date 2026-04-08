import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { CheckCircle2, Clock, AlertTriangle } from "lucide-react"
import { AddTaskDialog } from "./add-task-dialog"
import { GenerateTasksButton } from "./generate-tasks-button"
import { TaskList } from "./task-list"
import { PageHelp } from "@/components/page-help"

export default async function TasksPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const today = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()))

  const tasks = await db.task.findMany({
    where: { tenantId, deletedAt: null },
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true } },
      client: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
    take: 200,
  })

  const pendingTasks = tasks.filter(t => t.status === "pending")
  const completedTasks = tasks.filter(t => t.status === "completed")
  const todayTasks = pendingTasks.filter(t => {
    const d = new Date(t.dueDate)
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
  })
  const overdueTasks = pendingTasks.filter(t => new Date(t.dueDate) < today)

  const taskRows = tasks.map(t => ({
    id: t.id,
    title: t.title,
    type: t.type,
    autoTrigger: t.autoTrigger,
    status: t.status,
    dueDate: t.dueDate.toISOString().slice(0, 10),
    assigneeName: [t.assignee.lastName, t.assignee.firstName].filter(Boolean).join(" ") || "Без имени",
    clientId: t.clientId,
    clientName: t.client ? ([t.client.lastName, t.client.firstName].filter(Boolean).join(" ") || "Без имени") : null,
  }))

  const employees = await db.employee.findMany({
    where: { tenantId, deletedAt: null, isActive: true },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { lastName: "asc" },
  })

  const clients = await db.client.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { lastName: "asc" },
    take: 500,
  })

  const summary = [
    { title: "На сегодня", value: todayTasks.length, icon: Clock, color: "text-blue-600", bg: "bg-blue-50" },
    { title: "Просрочено", value: overdueTasks.length, icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
    { title: "Выполнено", value: completedTasks.length, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Задачи</h1>
          <PageHelp pageKey="tasks" />
        </div>
        <div className="flex items-center gap-2">
        <GenerateTasksButton />
        <AddTaskDialog
          employees={employees.map(e => ({ id: e.id, name: [e.lastName, e.firstName].filter(Boolean).join(" ") || "Без имени" }))}
          clients={clients.map(c => ({ id: c.id, name: [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени" }))}
        />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {summary.map((s) => (
          <Card key={s.title}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className={`flex size-10 items-center justify-center rounded-lg ${s.bg}`}>
                <s.icon className={`size-5 ${s.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.title}</p>
                <p className="text-2xl font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="rounded-md border">
        <TaskList tasks={taskRows} />
      </div>
    </div>
  )
}
