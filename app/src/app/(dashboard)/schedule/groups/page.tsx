import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { CreateGroupDialog } from "./create-group-dialog"

const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

export default async function GroupsPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const [groups, directions, branches, rooms, instructors] = await Promise.all([
    db.group.findMany({
      where: { tenantId, deletedAt: null },
      include: {
        direction: true,
        branch: true,
        room: true,
        instructor: { select: { id: true, firstName: true, lastName: true } },
        templates: { orderBy: { dayOfWeek: "asc" } },
        _count: { select: { enrollments: { where: { isActive: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.direction.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { sortOrder: "asc" },
    }),
    db.branch.findMany({
      where: { tenantId, deletedAt: null },
      include: { rooms: { where: { deletedAt: null } } },
    }),
    db.room.findMany({
      where: { tenantId, deletedAt: null },
    }),
    db.employee.findMany({
      where: { tenantId, deletedAt: null, isActive: true, role: "instructor" },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { lastName: "asc" },
    }),
  ])

  // Сериализуем данные для клиентского компонента
  const directionsOptions = directions.map((d) => ({
    id: d.id,
    name: d.name,
    lessonDuration: d.lessonDuration,
  }))

  const branchesWithRooms = branches.map((b) => ({
    id: b.id,
    name: b.name,
    rooms: b.rooms.map((r) => ({ id: r.id, name: r.name })),
  }))

  const instructorOptions = instructors.map((i) => ({
    id: i.id,
    name: `${i.lastName} ${i.firstName}`,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Группы</h1>
          <p className="text-sm text-muted-foreground">
            Управление группами и шаблонами расписания
          </p>
        </div>
        <CreateGroupDialog
          directions={directionsOptions}
          branches={branchesWithRooms}
          instructors={instructorOptions}
        />
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <div>
            <h2 className="text-lg font-semibold">Нет групп</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Создайте первую группу, чтобы начать формировать расписание
            </p>
          </div>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Направление</TableHead>
              <TableHead>Кабинет</TableHead>
              <TableHead>Педагог</TableHead>
              <TableHead>Расписание</TableHead>
              <TableHead>Учеников</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => {
              const instructorName = `${group.instructor.lastName} ${group.instructor.firstName}`
              const enrolled = group._count.enrollments
              const scheduleStr = group.templates
                .map((t) => `${DAY_SHORT[t.dayOfWeek]} ${t.startTime}`)
                .join(", ")

              return (
                <TableRow key={group.id}>
                  <TableCell>
                    <Link
                      href={`/schedule/groups/${group.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {group.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {group.direction.color ? (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block size-2.5 rounded-full"
                          style={{ backgroundColor: group.direction.color }}
                        />
                        {group.direction.name}
                      </span>
                    ) : (
                      group.direction.name
                    )}
                  </TableCell>
                  <TableCell>{group.room.name}</TableCell>
                  <TableCell>{instructorName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {scheduleStr || "—"}
                  </TableCell>
                  <TableCell>
                    <span className={enrolled >= group.maxStudents ? "text-red-600 font-medium" : ""}>
                      {enrolled}/{group.maxStudents}
                    </span>
                  </TableCell>
                  <TableCell>
                    {group.isActive ? (
                      <Badge variant="default">Активна</Badge>
                    ) : (
                      <Badge variant="secondary">Архив</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={`/schedule/groups/${group.id}`}>
                      <Button variant="ghost" size="sm">Открыть</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
