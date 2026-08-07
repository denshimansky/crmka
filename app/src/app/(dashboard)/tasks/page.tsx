import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { AddTaskDialog } from "./add-task-dialog"
import { GenerateTasksButton } from "./generate-tasks-button"
import { TasksBoard } from "./tasks-board"
import { PageHelp } from "@/components/page-help"
import { hasPermission, type RolePermissions } from "@/lib/permissions"
import { taskVisibilityWhere } from "@/lib/tasks/task-visibility"
import { branchScopeFromSession } from "@/lib/branch-scope"

export default async function TasksPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const role = session.user.role
  const employeeId = session.user.employeeId ?? null

  // Создавать/генерировать задачи может тот, кто редактирует клиентов
  // (владелец/управляющий/администратор). Инструктор и «только чтение» — не могут.
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { rolePermissions: true },
  })
  const orgPerms = (org?.rolePermissions as RolePermissions | null) ?? null
  const canManageTasks = hasPermission(role, "clients.edit", orgPerms)
  const canViewClients = hasPermission(role, "clients.view", orgPerms)

  // Сегодняшняя дата как «YYYY-MM-DD» — граница «сегодня/просрочено». Считаем в UTC,
  // чтобы совпадать с dueDate.toISOString() на строках задач (там тоже UTC): иначе на
  // сервере со сдвигом таймзоны граница «просрочено» уезжала бы на день. Сравнение
  // строковое (лексикографическое = хронологическое, см. tasks-board).
  const now = new Date()
  const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`

  // Автоочистка: выполненные задачи старше 2 месяцев — soft-delete.
  // Lazy cleanup при заходе на страницу задач (cron не настроен).
  const cleanupCutoff = new Date()
  cleanupCutoff.setMonth(cleanupCutoff.getMonth() - 2)
  await db.task.updateMany({
    where: {
      tenantId,
      deletedAt: null,
      status: "completed",
      completedAt: { lt: cleanupCutoff },
    },
    data: { deletedAt: new Date() },
  })

  // Инструктор/«только чтение» видят только свои задачи (assignedTo = я);
  // управленцы — все задачи организации. См. lib/tasks/task-visibility.ts.
  // ADM-04: админ с привязкой к филиалу видит только задачи своих филиалов
  // (тот же scope, что на дашборде) — согласовано с task-visibility.
  const scope = branchScopeFromSession(session.user.allowedBranchIds)
  const visibilityWhere = {
    tenantId,
    deletedAt: null,
    ...taskVisibilityWhere(role, employeeId, scope),
  }

  // Актуальные (невыполненные) и выполненные грузим РАЗДЕЛЬНО: при общем take c
  // orderBy status бэклог невыполненных мог полностью вытеснить выполненные, и
  // вкладка «Выполненные» показывала пусто. Теперь у каждой выборки свой лимит.
  // Актуальные — по сроку (просроченные впереди), выполненные — по дате выполнения
  // (свежие сверху). cancelled ни в одну вкладку не входит — не грузим.
  //
  // Лимит 2000 (а не 200): у активных организаций и невыполненных, и выполненных
  // за 2 месяца бывает 800–1200 (автозадачи каждый день). При 200 «Выполненные»
  // обрезались, а «Просроченные»/счётчики на плитках недосчитывали. Выполненные
  // старше 2 месяцев и так уходят автоочисткой выше, так что рост ограничен.
  const TASK_FETCH_LIMIT = 2000
  const [pendingTasks, completedTasks] = await Promise.all([
    db.task.findMany({
      where: { ...visibilityWhere, status: "pending" },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true } },
        client: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { dueDate: "asc" },
      take: TASK_FETCH_LIMIT,
    }),
    db.task.findMany({
      where: { ...visibilityWhere, status: "completed" },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true } },
        client: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { completedAt: "desc" },
      take: TASK_FETCH_LIMIT,
    }),
  ])
  const tasks = [...pendingTasks, ...completedTasks]

  // Имя выполнившего задачу: у Task.completedBy нет relation — резолвим отдельным
  // запросом по собранным id (сотрудник мог быть уволен — deletedAt не фильтруем).
  const completerIds = [...new Set(tasks.map(t => t.completedBy).filter((x): x is string => !!x))]
  const completers = completerIds.length
    ? await db.employee.findMany({
        where: { tenantId, id: { in: completerIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : []
  const completerName = new Map(
    completers.map(e => [e.id, [e.lastName, e.firstName].filter(Boolean).join(" ") || "Без имени"]),
  )

  const taskRows = tasks.map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    type: t.type,
    autoTrigger: t.autoTrigger,
    status: t.status,
    dueDate: t.dueDate.toISOString().slice(0, 10),
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    completedByName: t.completedBy ? (completerName.get(t.completedBy) ?? null) : null,
    assigneeName: [t.assignee.lastName, t.assignee.firstName].filter(Boolean).join(" ") || "Без имени",
    clientId: t.clientId,
    clientName: t.client ? ([t.client.lastName, t.client.firstName].filter(Boolean).join(" ") || "Без имени") : null,
  }))

  // Списки сотрудников и клиентов нужны только для формы создания задачи.
  // Не грузим их (и не отдаём в браузер клиентскую базу) тем, кто не создаёт задачи.
  const employees = canManageTasks
    ? await db.employee.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        select: { id: true, firstName: true, lastName: true },
        orderBy: { lastName: "asc" },
      })
    : []

  const clients = canManageTasks
    ? await db.client.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true },
        orderBy: { lastName: "asc" },
        take: 500,
      })
    : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Задачи</h1>
          <PageHelp pageKey="tasks" />
        </div>
        {canManageTasks && (
          <div className="flex items-center gap-2">
          <GenerateTasksButton />
          <AddTaskDialog
            employees={employees.map(e => ({ id: e.id, name: [e.lastName, e.firstName].filter(Boolean).join(" ") || "Без имени" }))}
            clients={clients.map(c => ({ id: c.id, name: [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени" }))}
          />
          </div>
        )}
      </div>

      <TasksBoard
        tasks={taskRows}
        today={todayStr}
        canDelete={canManageTasks}
        canViewClients={canViewClients}
      />
    </div>
  )
}
