import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table"
import { CreateEmployeeDialog } from "./create-employee-dialog"
import { EditEmployeeDialog } from "./edit-employee-dialog"
import type { Role } from "@prisma/client"

const ROLE_LABELS: Record<Role, string> = {
  owner: "Владелец",
  manager: "Управляющий",
  admin: "Администратор",
  instructor: "Инструктор",
  readonly: "Только чтение",
}

const ROLE_COLORS: Record<Role, string> = {
  owner: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  manager: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  admin: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  instructor: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  readonly: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
}

function formatDate(date: Date | null) {
  if (!date) return "—"
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export default async function StaffPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const canEdit = session.user.role === "owner" || session.user.role === "manager"

  const [employees, branches] = await Promise.all([
    db.employee.findMany({
      where: { tenantId, deletedAt: null },
      include: {
        employeeBranches: {
          include: { branch: { select: { id: true, name: true } } },
        },
      },
      orderBy: { lastName: "asc" },
    }),
    db.branch.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Сотрудники</h1>
        {canEdit && <CreateEmployeeDialog branches={branches} />}
      </div>

      {employees.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет сотрудников
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ФИО</TableHead>
                  <TableHead>Логин</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>Филиалы</TableHead>
                  <TableHead>Телефон</TableHead>
                  <TableHead>Дата рождения</TableHead>
                  <TableHead>Статус</TableHead>
                  {canEdit && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((emp) => {
                  const fullName = [emp.lastName, emp.firstName, emp.middleName]
                    .filter(Boolean)
                    .join(" ")
                  const branchNames = emp.employeeBranches
                    .map((eb) => eb.branch.name)
                    .join(", ")

                  return (
                    <TableRow key={emp.id}>
                      <TableCell className="font-medium">{fullName}</TableCell>
                      <TableCell className="font-mono text-xs">{emp.login}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[emp.role]}`}>
                          {ROLE_LABELS[emp.role]}
                        </span>
                      </TableCell>
                      <TableCell>
                        {branchNames || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {emp.phone || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {formatDate(emp.birthDate)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={emp.isActive ? "default" : "secondary"}>
                          {emp.isActive ? "Активен" : "Неактивен"}
                        </Badge>
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <EditEmployeeDialog
                            employee={{
                              ...emp,
                              birthDate: emp.birthDate?.toISOString() || null,
                            }}
                            branches={branches}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
