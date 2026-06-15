import { PageHelp } from "@/components/page-help"
import { getSession } from "@/lib/session"
import { branchScopeFromSession, scopeBranch, scopeRoom, scopeEmployee } from "@/lib/branch-scope"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowLeft, AlertTriangle } from "lucide-react"
import Link from "next/link"
import { AbsencesView } from "./absences-table"
import type { Prisma, ClientSegment } from "@prisma/client"

const SEGMENT_LABELS: Record<ClientSegment, string> = {
  new_client: "Новый",
  standard: "Стандарт",
  regular: "Постоянный",
  vip: "VIP",
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])))
  return isNaN(d.getTime()) ? null : d
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function startOfMonthUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1))
}

function endOfMonthUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59))
}

function clientName(c: { firstName: string | null; lastName: string | null }): string {
  return [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени"
}

function wardName(w: { firstName: string; lastName: string | null } | null): string | null {
  if (!w) return null
  return [w.lastName, w.firstName].filter(Boolean).join(" ") || null
}

function instructorName(e: { firstName: string | null; lastName: string }): string {
  return [e.lastName, e.firstName].filter(Boolean).join(" ") || "—"
}

export interface AbsenceDetail {
  date: string // ISO YYYY-MM-DD
  attendanceTypeName: string | null
  balance: number | null
  comment: string | null
}

export interface AbsenceGroupRow {
  key: string
  branchName: string
  clientId: string
  clientLabel: string // "ФИО клиента" или "ФИО подопечного · Род. ФИО"
  directionName: string
  segmentLabel: string
  instructorName: string
  details: AbsenceDetail[]
}

interface FilterOption {
  id: string
  name: string
}

export default async function LessonsAbsencesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = branchScopeFromSession(session.user.allowedBranchIds)
  const sp = await searchParams

  const now = new Date()
  const defaultFrom = startOfMonthUtc(now.getUTCFullYear(), now.getUTCMonth())
  const defaultTo = endOfMonthUtc(now.getUTCFullYear(), now.getUTCMonth())

  const fromParam = typeof sp.from === "string" ? sp.from : undefined
  const toParam = typeof sp.to === "string" ? sp.to : undefined
  const dateFrom = parseDate(fromParam) ?? defaultFrom
  const dateToRaw = parseDate(toParam) ?? defaultTo
  // Конец дня по выбранной верхней границе
  const dateTo = new Date(Date.UTC(
    dateToRaw.getUTCFullYear(),
    dateToRaw.getUTCMonth(),
    dateToRaw.getUTCDate(),
    23, 59, 59
  ))

  const tab = sp.tab === "unmarked" ? "unmarked" : "noshow"
  const branchId = typeof sp.branchId === "string" && sp.branchId ? sp.branchId : undefined
  const roomId = typeof sp.roomId === "string" && sp.roomId ? sp.roomId : undefined
  const directionId = typeof sp.directionId === "string" && sp.directionId ? sp.directionId : undefined
  const instructorId = typeof sp.instructorId === "string" && sp.instructorId ? sp.instructorId : undefined

  // Справочники для фильтров
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
        // Фильтр «Педагог» — только инструкторы (роль instructor = «педагог»);
        // админы/управляющие/владелец не ведут занятия и в фильтре не нужны (баг #7).
        role: "instructor",
        ...scopeEmployee(scope),
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ])

  // Общие условия по группе для всех запросов
  const groupWhere: Prisma.GroupWhereInput = {}
  if (branchId) groupWhere.branchId = branchId
  else if (scope.mode === "limited") groupWhere.branchId = { in: scope.branchIds }
  if (roomId) groupWhere.roomId = roomId
  if (directionId) groupWhere.directionId = directionId

  const lessonWhereBase: Prisma.LessonWhereInput = {
    tenantId,
    date: { gte: dateFrom, lte: dateTo },
    status: { not: "cancelled" },
  }
  if (Object.keys(groupWhere).length > 0) lessonWhereBase.group = groupWhere
  if (instructorId) lessonWhereBase.instructorId = instructorId
  // Инструктор видит только свои занятия (ведущий или замена) — чужие пропуски не показываем.
  if (session.user.role === "instructor") {
    lessonWhereBase.OR = [
      { instructorId: session.user.employeeId },
      { substituteInstructorId: session.user.employeeId },
    ]
  }

  // === Вкладка 1: "Не был" (no_show) ===
  const noShowAttendances = await db.attendance.findMany({
    where: {
      tenantId,
      isPending: false,
      attendanceType: { code: "no_show" },
      lesson: lessonWhereBase,
    },
    select: {
      id: true,
      clientId: true,
      wardId: true,
      subscriptionId: true,
      lesson: {
        select: {
          id: true,
          date: true,
          groupId: true,
          group: {
            select: {
              directionId: true,
              direction: { select: { name: true } },
              branch: { select: { name: true } },
              instructor: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
      client: {
        select: { id: true, firstName: true, lastName: true, segment: true },
      },
      attendanceType: { select: { name: true } },
      absenceReason: { select: { name: true } },
      subscription: {
        select: { balance: true, finalAmount: true },
      },
    },
    orderBy: { lesson: { date: "asc" } },
  })

  const noShowWardIds = Array.from(
    new Set(
      noShowAttendances
        .map((a) => a.wardId)
        .filter((id): id is string => !!id),
    ),
  )
  const noShowWards = noShowWardIds.length > 0
    ? await db.ward.findMany({
        where: { tenantId, id: { in: noShowWardIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : []
  const noShowWardMap = new Map(noShowWards.map((w) => [w.id, w]))

  const noShowCount = noShowAttendances.length

  // === Вкладка 2: "Неотмеченные" — прошедшие занятия без отметки ===
  // Берём только прошедшие занятия (date <= вчерашний день включительно — т.е. строго до сегодня).
  // Если выбранный период уже в будущем, считаем 0.
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const effectiveTo = dateTo < todayUtc ? dateTo : new Date(todayUtc.getTime() - 1)

  const unmarkedLessonWhere: Prisma.LessonWhereInput = {
    ...lessonWhereBase,
    date: { gte: dateFrom, lte: effectiveTo },
  }

  const pastLessons = effectiveTo >= dateFrom
    ? await db.lesson.findMany({
        where: unmarkedLessonWhere,
        select: {
          id: true,
          date: true,
          groupId: true,
          group: {
            select: {
              id: true,
              directionId: true,
              direction: { select: { name: true } },
              branch: { select: { name: true } },
              instructor: { select: { firstName: true, lastName: true } },
            },
          },
          attendances: {
            select: { clientId: true, wardId: true, isPending: true },
          },
        },
        orderBy: { date: "asc" },
      })
    : []

  const groupIds = Array.from(new Set(pastLessons.map((l) => l.groupId)))

  const enrollments = groupIds.length > 0
    ? await db.groupEnrollment.findMany({
        where: {
          tenantId,
          isActive: true,
          deletedAt: null,
          groupId: { in: groupIds },
        },
        select: {
          groupId: true,
          clientId: true,
          wardId: true,
          enrolledAt: true,
          withdrawnAt: true,
          client: {
            select: { id: true, firstName: true, lastName: true, segment: true },
          },
          ward: { select: { firstName: true, lastName: true } },
        },
      })
    : []

  const enrollmentsByGroup = new Map<string, typeof enrollments>()
  for (const e of enrollments) {
    const arr = enrollmentsByGroup.get(e.groupId) || []
    arr.push(e)
    enrollmentsByGroup.set(e.groupId, arr)
  }

  interface UnmarkedEntry {
    lessonDate: Date
    groupId: string
    directionId: string
    directionName: string
    branchName: string
    instructorName: string
    clientId: string
    clientFirstName: string | null
    clientLastName: string | null
    segment: ClientSegment
    wardId: string | null
    wardFirstName: string | null
    wardLastName: string | null
    isPending: boolean
  }

  const unmarkedEntries: UnmarkedEntry[] = []
  for (const lesson of pastLessons) {
    const groupEnrollments = enrollmentsByGroup.get(lesson.groupId) || []
    const attendedMap = new Map<string, { isPending: boolean }>()
    for (const a of lesson.attendances) {
      attendedMap.set(`${a.clientId}|${a.wardId || ""}`, { isPending: a.isPending })
    }
    for (const e of groupEnrollments) {
      if (e.enrolledAt > lesson.date) continue
      if (e.withdrawnAt && e.withdrawnAt <= lesson.date) continue
      const key = `${e.clientId}|${e.wardId || ""}`
      const att = attendedMap.get(key)
      if (att && !att.isPending) continue // отметка есть и не заглушка
      unmarkedEntries.push({
        lessonDate: lesson.date,
        groupId: lesson.groupId,
        directionId: lesson.group.directionId,
        directionName: lesson.group.direction.name,
        branchName: lesson.group.branch.name,
        instructorName: instructorName(lesson.group.instructor),
        clientId: e.clientId,
        clientFirstName: e.client.firstName,
        clientLastName: e.client.lastName,
        segment: e.client.segment,
        wardId: e.wardId,
        wardFirstName: e.ward?.firstName ?? null,
        wardLastName: e.ward?.lastName ?? null,
        isPending: !!att?.isPending,
      })
    }
  }

  const unmarkedCount = unmarkedEntries.length

  // === Загружаем подписки клиентов для расчёта колонки "Баланс" ===
  const allClientIds = new Set<string>()
  if (tab === "noshow") {
    for (const a of noShowAttendances) allClientIds.add(a.clientId)
  } else {
    for (const e of unmarkedEntries) allClientIds.add(e.clientId)
  }

  const subscriptions = allClientIds.size > 0
    ? await db.subscription.findMany({
        where: {
          tenantId,
          deletedAt: null,
          status: { in: ["pending", "active"] },
          clientId: { in: Array.from(allClientIds) },
        },
        select: {
          clientId: true,
          wardId: true,
          directionId: true,
          startDate: true,
          endDate: true,
          balance: true,
          finalAmount: true,
        },
      })
    : []

  function findUnpaidAmount(
    clientId: string,
    wardId: string | null,
    directionId: string,
    lessonDate: Date,
  ): number | null {
    const sub = subscriptions.find((s) => {
      if (s.clientId !== clientId) return false
      if (s.directionId !== directionId) return false
      if ((s.wardId || null) !== (wardId || null)) return false
      if (s.startDate > lessonDate) return false
      if (s.endDate && s.endDate < lessonDate) return false
      return true
    })
    if (!sub) return null
    const balance = Number(sub.balance)
    if (balance <= 0) return null
    return Number(sub.finalAmount)
  }

  // === Формируем строки для выбранной вкладки ===
  const groupsMap = new Map<string, AbsenceGroupRow>()

  function buildClientLabel(
    clientFirst: string | null,
    clientLast: string | null,
    wardFirst: string | null,
    wardLast: string | null,
  ): string {
    const own = clientName({ firstName: clientFirst, lastName: clientLast })
    if (!wardFirst && !wardLast) return own
    const wn = wardName({ firstName: wardFirst || "", lastName: wardLast })
    if (!wn) return own
    return `${wn} · ${own}`
  }

  if (tab === "noshow") {
    for (const a of noShowAttendances) {
      const key = `${a.clientId}|${a.wardId || ""}|${a.lesson.groupId}`
      const lessonDate = a.lesson.date
      const balance = findUnpaidAmount(
        a.clientId,
        a.wardId,
        a.lesson.group.directionId,
        lessonDate,
      )
      const ward = a.wardId ? noShowWardMap.get(a.wardId) : null
      const detail: AbsenceDetail = {
        date: toIsoDate(lessonDate),
        attendanceTypeName: a.attendanceType.name,
        balance,
        comment: a.absenceReason?.name ?? null,
      }
      const existing = groupsMap.get(key)
      if (existing) {
        existing.details.push(detail)
      } else {
        groupsMap.set(key, {
          key,
          branchName: a.lesson.group.branch.name,
          clientId: a.clientId,
          clientLabel: buildClientLabel(
            a.client.firstName,
            a.client.lastName,
            ward?.firstName ?? null,
            ward?.lastName ?? null,
          ),
          directionName: a.lesson.group.direction.name,
          segmentLabel: SEGMENT_LABELS[a.client.segment],
          instructorName: instructorName(a.lesson.group.instructor),
          details: [detail],
        })
      }
    }
  } else {
    for (const e of unmarkedEntries) {
      const key = `${e.clientId}|${e.wardId || ""}|${e.groupId}`
      const balance = findUnpaidAmount(e.clientId, e.wardId, e.directionId, e.lessonDate)
      const detail: AbsenceDetail = {
        date: toIsoDate(e.lessonDate),
        attendanceTypeName: e.isPending ? "Ожидание отметки" : null,
        balance,
        comment: null,
      }
      const existing = groupsMap.get(key)
      if (existing) {
        existing.details.push(detail)
      } else {
        groupsMap.set(key, {
          key,
          branchName: e.branchName,
          clientId: e.clientId,
          clientLabel: buildClientLabel(
            e.clientFirstName,
            e.clientLastName,
            e.wardFirstName,
            e.wardLastName,
          ),
          directionName: e.directionName,
          segmentLabel: SEGMENT_LABELS[e.segment],
          instructorName: e.instructorName,
          details: [detail],
        })
      }
    }
  }

  // Сортируем группы по филиалу+ФИО, детали — по дате
  const rows = Array.from(groupsMap.values())
    .map((g) => ({ ...g, details: g.details.sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => {
      const c = a.branchName.localeCompare(b.branchName, "ru")
      if (c !== 0) return c
      return a.clientLabel.localeCompare(b.clientLabel, "ru")
    })

  const filterOptions: {
    branches: FilterOption[]
    rooms: { id: string; name: string; branchId: string }[]
    directions: FilterOption[]
    instructors: { id: string; name: string }[]
  } = {
    branches: branches.map((b) => ({ id: b.id, name: b.name })),
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, branchId: r.branchId })),
    directions: directions.map((d) => ({ id: d.id, name: d.name })),
    instructors: instructors.map((e) => ({
      id: e.id,
      name: instructorName(e),
    })),
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/lessons" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Пропуски</h1>
            <PageHelp pageKey="lessons/absences" />
          </div>
          <p className="text-sm text-muted-foreground">
            Реестр неявок и неотмеченных посещений за период
          </p>
        </div>
      </div>

      <AbsencesView
        rows={rows}
        noShowCount={noShowCount}
        unmarkedCount={unmarkedCount}
        tab={tab}
        from={toIsoDate(dateFrom)}
        to={toIsoDate(dateToRaw)}
        branchId={branchId ?? ""}
        roomId={roomId ?? ""}
        directionId={directionId ?? ""}
        instructorId={instructorId ?? ""}
        filterOptions={filterOptions}
      />

      {rows.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
            <AlertTriangle className="size-10 text-muted-foreground/50" />
            <p>
              {tab === "noshow"
                ? "За выбранный период нет занятий с отметкой «Не был»."
                : "За выбранный период все прошедшие занятия отмечены."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
