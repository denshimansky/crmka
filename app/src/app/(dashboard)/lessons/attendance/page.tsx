import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { branchScopeFromSession, scopeBranch, scopeRoom, scopeEmployee } from "@/lib/branch-scope"
import { db } from "@/lib/db"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import type { Prisma } from "@prisma/client"
import { AttendanceGrid } from "./attendance-grid"

function clientName(c: { firstName: string | null; lastName: string | null }): string {
  return [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени"
}

function instructorShortName(e: { firstName: string | null; lastName: string }): string {
  const initial = e.firstName?.[0] ? `${e.firstName[0]}.` : ""
  return [e.lastName, initial].filter(Boolean).join(" ").trim() || "—"
}

export interface AttendanceTypeOption {
  id: string
  code: string
  name: string
}

export interface AttendanceCellData {
  lessonId: string
  attendanceId: string | null
  attendanceTypeCode: string | null
  attendanceTypeName: string | null
  isPending: boolean
}

export interface AttendanceRow {
  key: string // clientId|wardId|groupId
  clientId: string
  wardId: string | null
  contragentLabel: string
  parentLabel: string | null // ФИО родителя под подопечным
  birthDate: string | null // ISO YYYY-MM-DD
  toPayAmount: number | null // balance не оплаченного абонемента
  groupName: string
  instructorLabel: string
  planCount: number
  cells: (AttendanceCellData | null)[] // длина = daysInMonth, null если нет занятия
}

const DAY_OF_WEEK_LABELS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]

export default async function LessonsAttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = branchScopeFromSession(session.user.allowedBranchIds)
  const sp = await searchParams
  const { year, month } = getMonthFromParams(sp)

  const branchId = typeof sp.branchId === "string" && sp.branchId ? sp.branchId : undefined
  const roomId = typeof sp.roomId === "string" && sp.roomId ? sp.roomId : undefined
  const directionId = typeof sp.directionId === "string" && sp.directionId ? sp.directionId : undefined
  const instructorId = typeof sp.instructorId === "string" && sp.instructorId ? sp.instructorId : undefined
  const groupId = typeof sp.groupId === "string" && sp.groupId ? sp.groupId : undefined

  const dateFrom = new Date(Date.UTC(year, month - 1, 1))
  const dateTo = new Date(Date.UTC(year, month, 0, 23, 59, 59))
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()

  // Заголовки колонок-дней
  const dayHeaders = Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1, i + 1))
    return {
      day: i + 1,
      dow: DAY_OF_WEEK_LABELS[d.getUTCDay()],
      isWeekend: d.getUTCDay() === 0 || d.getUTCDay() === 6,
    }
  })

  // === Справочники для фильтров ===
  const [branches, rooms, directions, instructors] = await Promise.all([
    db.branch.findMany({
      where: { tenantId, deletedAt: null, ...scopeBranch(scope) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.room.findMany({
      where: { tenantId, deletedAt: null, ...scopeRoom(scope) },
      select: { id: true, name: true, branchId: true },
      orderBy: { name: "asc" },
    }),
    db.direction.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.employee.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        role: { in: ["instructor", "admin", "manager", "owner"] },
        ...scopeEmployee(scope),
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ])

  // Инструктор видит только СВОИ занятия — где он назначен преподом (instructorId)
  // или стоит на замене (substituteInstructorId). В сетке это значит: показываем
  // только группы, в которых есть его занятия в этом месяце, и только эти занятия
  // (в чужой группе, где он заменяет одно занятие, видна только эта колонка).
  const instructorLessonFilter: Prisma.LessonWhereInput | null =
    session.user.role === "instructor"
      ? {
          OR: [
            { instructorId: session.user.employeeId },
            { substituteInstructorId: session.user.employeeId },
          ],
        }
      : null

  const groupWhere: Prisma.GroupWhereInput = {
    tenantId,
    deletedAt: null,
    isOneTime: false,
  }
  if (instructorLessonFilter) {
    groupWhere.lessons = {
      some: {
        ...instructorLessonFilter,
        date: { gte: dateFrom, lte: dateTo },
        status: { not: "cancelled" },
      },
    }
  }
  if (branchId) groupWhere.branchId = branchId
  else if (scope.mode === "limited") groupWhere.branchId = { in: scope.branchIds }
  if (roomId) groupWhere.roomId = roomId
  if (directionId) groupWhere.directionId = directionId
  if (instructorId) groupWhere.instructorId = instructorId

  const groups = await db.group.findMany({
    where: groupWhere,
    select: {
      id: true,
      name: true,
      directionId: true,
      branchId: true,
      roomId: true,
      direction: { select: { name: true } },
      branch: { select: { name: true } },
      room: { select: { name: true } },
      instructor: { select: { firstName: true, lastName: true } },
    },
    orderBy: { name: "asc" },
  })

  // Для селекта групп нужен исходный список без сужения по выбранной группе,
  // плюс instructorId, чтобы Группа реактивно фильтровалась на клиенте.
  const groupOptionsRaw = await db.group.findMany({
    where: {
      tenantId,
      deletedAt: null,
      isOneTime: false,
      ...(scope.mode === "limited" ? { branchId: { in: scope.branchIds } } : {}),
      ...(instructorLessonFilter ? { lessons: { some: instructorLessonFilter } } : {}),
    },
    select: {
      id: true,
      name: true,
      branchId: true,
      directionId: true,
      instructorId: true,
    },
    orderBy: { name: "asc" },
  })
  const groupOptions = groupOptionsRaw.map((g) => ({
    id: g.id,
    name: g.name,
    branchId: g.branchId,
    directionId: g.directionId,
    instructorId: g.instructorId,
  }))

  const effectiveGroupIds = groupId
    ? groups.filter((g) => g.id === groupId).map((g) => g.id)
    : groups.map((g) => g.id)

  // === Типы посещений для dropdown отметки ===
  const attendanceTypes = await db.attendanceType.findMany({
    where: {
      OR: [{ tenantId }, { tenantId: null }],
      isActive: true,
      availableToAdmin: true,
    },
    select: { id: true, code: true, name: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })
  // Для быстрой отметки исключаем makeup_scheduled (требует выбора целевого
  // занятия) и makeup (создаётся системой при отработке). Оператор может
  // выставить их из карточки занятия.
  const QUICK_MARK_CODES = ["present", "no_show", "excused", "absent", "recalculation"]
  const typeOptions: AttendanceTypeOption[] = attendanceTypes
    .filter((t) => QUICK_MARK_CODES.includes(t.code))
    .map((t) => ({ id: t.id, code: t.code, name: t.name }))

  // === Lessons за месяц по выбранным группам ===
  const lessons = effectiveGroupIds.length > 0
    ? await db.lesson.findMany({
        where: {
          tenantId,
          date: { gte: dateFrom, lte: dateTo },
          status: { not: "cancelled" },
          groupId: { in: effectiveGroupIds },
          // Инструктору — только его занятия (преподаёт или заменяет).
          ...(instructorLessonFilter ?? {}),
        },
        select: {
          id: true,
          date: true,
          groupId: true,
          attendances: {
            select: {
              id: true,
              clientId: true,
              wardId: true,
              isPending: true,
              attendanceType: { select: { code: true, name: true } },
            },
          },
        },
      })
    : []

  // Группируем lessons по groupId+day
  const lessonsByGroupDay = new Map<string, { lessonId: string; attendances: typeof lessons[number]["attendances"] }>()
  for (const l of lessons) {
    const day = l.date.getUTCDate()
    const key = `${l.groupId}|${day}`
    // Если в один день у группы вдруг два занятия — берём первое.
    if (!lessonsByGroupDay.has(key)) {
      lessonsByGroupDay.set(key, { lessonId: l.id, attendances: l.attendances })
    }
  }

  // === Активные зачисления ===
  const enrollments = effectiveGroupIds.length > 0
    ? await db.groupEnrollment.findMany({
        where: {
          tenantId,
          isActive: true,
          deletedAt: null,
          groupId: { in: effectiveGroupIds },
          enrolledAt: { lte: dateTo },
          OR: [{ withdrawnAt: null }, { withdrawnAt: { gt: dateFrom } }],
        },
        select: {
          id: true,
          groupId: true,
          clientId: true,
          wardId: true,
          enrolledAt: true,
          withdrawnAt: true,
          client: { select: { id: true, firstName: true, lastName: true } },
        },
      })
    : []

  // Wards подгружаем отдельно
  const wardIds = Array.from(
    new Set(enrollments.map((e) => e.wardId).filter((v): v is string => !!v)),
  )
  const wards = wardIds.length > 0
    ? await db.ward.findMany({
        where: { tenantId, id: { in: wardIds } },
        select: { id: true, firstName: true, lastName: true, birthDate: true, clientId: true },
      })
    : []
  const wardMap = new Map(wards.map((w) => [w.id, w]))

  // === Подписки клиентов для расчёта «К оплате» ===
  const clientIds = Array.from(new Set(enrollments.map((e) => e.clientId)))
  const subscriptions = clientIds.length > 0
    ? await db.subscription.findMany({
        where: {
          tenantId,
          deletedAt: null,
          status: { in: ["pending", "active"] },
          clientId: { in: clientIds },
          groupId: { in: effectiveGroupIds },
        },
        select: {
          clientId: true,
          wardId: true,
          groupId: true,
          periodYear: true,
          periodMonth: true,
          startDate: true,
          endDate: true,
          balance: true,
        },
      })
    : []

  function findSubscriptionBalance(
    clientId: string,
    wardId: string | null,
    gId: string,
  ): number | null {
    const sub = subscriptions.find((s) => {
      if (s.clientId !== clientId) return false
      if ((s.wardId || null) !== (wardId || null)) return false
      if (s.groupId !== gId) return false
      if (s.periodYear != null && s.periodMonth != null) {
        return s.periodYear === year && s.periodMonth === month
      }
      // Пакетный: период покрывает месяц
      if (s.startDate > dateTo) return false
      if (s.endDate && s.endDate < dateFrom) return false
      return true
    })
    if (!sub) return null
    const balance = Number(sub.balance)
    if (balance <= 0) return null
    return balance
  }

  // === Строим строки ===
  const groupById = new Map(groups.map((g) => [g.id, g]))
  const rows: AttendanceRow[] = []

  for (const e of enrollments) {
    const g = groupById.get(e.groupId)
    if (!g) continue
    const ward = e.wardId ? wardMap.get(e.wardId) : null

    // Содержимое колонки «Контрагент»
    const parent = clientName(e.client)
    const contragentLabel = ward
      ? clientName({ firstName: ward.firstName, lastName: ward.lastName })
      : parent
    const parentLabel = ward ? parent : null

    const birthDate = ward?.birthDate ? ward.birthDate.toISOString().slice(0, 10) : null

    const cells: (AttendanceCellData | null)[] = []
    let planCount = 0
    for (let day = 1; day <= daysInMonth; day++) {
      const lessonDate = new Date(Date.UTC(year, month - 1, day))
      // Выбывшие из группы — ячейки после withdrawnAt пустые. enrolledAt тут
      // НЕ проверяем по дню: enrollment-query уже отсекает зачисления, которые
      // ещё не начались на момент конца месяца (enrolledAt <= dateTo), а внутри
      // месяца ученик мог попасть в группу позже первого занятия — но марки в
      // его строке всё равно надо показывать (например, при бэкфилле истории
      // импортом или ручным дозачислением задним числом).
      if (e.withdrawnAt && e.withdrawnAt <= lessonDate) {
        cells.push(null)
        continue
      }
      const lessonInfo = lessonsByGroupDay.get(`${e.groupId}|${day}`)
      if (!lessonInfo) {
        cells.push(null)
        continue
      }
      planCount++
      const att = lessonInfo.attendances.find((a) => {
        if (a.clientId !== e.clientId) return false
        return (a.wardId || null) === (e.wardId || null)
      })
      cells.push({
        lessonId: lessonInfo.lessonId,
        attendanceId: att?.id ?? null,
        attendanceTypeCode: att && !att.isPending ? att.attendanceType.code : null,
        attendanceTypeName: att && !att.isPending ? att.attendanceType.name : null,
        isPending: !!att?.isPending,
      })
    }

    rows.push({
      key: `${e.clientId}|${e.wardId || ""}|${e.groupId}`,
      clientId: e.clientId,
      wardId: e.wardId,
      contragentLabel,
      parentLabel,
      birthDate,
      toPayAmount: findSubscriptionBalance(e.clientId, e.wardId, e.groupId),
      groupName: g.name,
      instructorLabel: instructorShortName(g.instructor),
      planCount,
      cells,
    })
  }

  // Сортировка: сначала по группе, потом по ФИО контрагента
  rows.sort((a, b) => {
    const c1 = a.groupName.localeCompare(b.groupName, "ru")
    if (c1 !== 0) return c1
    return a.contragentLabel.localeCompare(b.contragentLabel, "ru")
  })

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
          <p className="text-sm text-muted-foreground">
            Сетка посещений по группам и дням месяца
          </p>
        </div>
        <MonthPicker />
      </div>

      <AttendanceGrid
        rows={rows}
        dayHeaders={dayHeaders}
        branchId={branchId ?? ""}
        roomId={roomId ?? ""}
        directionId={directionId ?? ""}
        instructorId={instructorId ?? ""}
        groupId={groupId ?? ""}
        filterOptions={{
          branches: branches.map((b) => ({ id: b.id, name: b.name })),
          rooms: rooms.map((r) => ({ id: r.id, name: r.name, branchId: r.branchId })),
          directions: directions.map((d) => ({ id: d.id, name: d.name })),
          instructors: instructors.map((e) => ({
            id: e.id,
            name: instructorShortName(e),
          })),
          groups: groupOptions,
        }}
        typeOptions={typeOptions}
      />
    </div>
  )
}
