import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { branchScopeFromSession, scopeBranch, scopeRoom, scopeEmployee } from "@/lib/branch-scope"
import { db } from "@/lib/db"
import {
  rosterWhereOnDate,
  isEnrolledOnLesson,
  buildCoverageResolver,
} from "@/lib/subscriptions/roster-filter"
import { getAttendanceTypeOverrideMap, applyAttendanceOverride } from "@/lib/subscriptions/withdrawal-block"
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
  startTime: string // «ЧЧ:ММ» — различает занятия, когда их в один день несколько
  attendanceId: string | null
  attendanceTypeCode: string | null
  attendanceTypeName: string | null
  isPending: boolean
  // Пробное занятие: ячейка отмечается через /api/trial-lessons/[id], а не через
  // обычное посещение. trialStatus задаёт цвет/букву, trialId — цель отметки.
  isTrial?: boolean
  trialId?: string | null
  trialStatus?: "scheduled" | "attended" | "no_show" | null
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
  // Длина = daysInMonth. Элемент — занятия дня (обычно 0–1, но у групп с
  // несколькими занятиями в день — по расписанию или после переноса — бывает
  // 2+, каждое отмечается отдельно).
  cells: AttendanceCellData[][]
  isTrial?: boolean // строка пробного ученика (лид на пробном в группе)
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
        // Фильтр «Инструктор» — только инструкторы (роль instructor = «инструктор»);
        // админы/управляющие/владелец не ведут занятия и в фильтре не нужны (баг #7).
        role: "instructor",
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
  // Список фильтруем как в карточке занятия и реестре пропусков (не по белому
  // списку системных кодов — он прятал кастомные типы организации):
  // — «Назначена отработка» / «Отработка» требуют выбора целевого занятия —
  //   их ставят из карточки занятия;
  // — инструктор видит availableToInstructor, админ — availableToAdmin, владелец/
  //   управляющий — всё, «только чтение» не отмечает.
  const role = session.user.role
  // Пер-орг оверрайд системных типов (баг #82): отключённые исключаем, доступ роли — эффективный.
  const typeOverrideMap = role !== "readonly" ? await getAttendanceTypeOverrideMap(db, tenantId) : new Map()
  const attendanceTypes = role !== "readonly"
    ? await db.attendanceType.findMany({
        where: {
          OR: [{ tenantId }, { tenantId: null }],
          isActive: true,
        },
        select: {
          id: true,
          code: true,
          name: true,
          availableToInstructor: true,
          availableToAdmin: true,
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      })
    : []
  const typeOptions: AttendanceTypeOption[] = attendanceTypes
    .map((t) => applyAttendanceOverride(t, typeOverrideMap.get(t.id)))
    .filter((t) => {
      if (t.isDisabledForTenant) return false
      if (t.code === "makeup_scheduled" || t.code === "makeup") return false
      if (role === "instructor") return t.availableToInstructor
      if (role === "admin") return t.availableToAdmin
      return true
    })
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
          startTime: true,
          rescheduledFromDate: true,
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

  // Группируем lessons по groupId+day (день — по фактической дате занятия).
  // rescheduledFromDate тянем, чтобы граница состава для перенесённого занятия
  // считалась по исходной дате (см. ниже isEnrolledOnLesson). В один день у группы
  // бывает НЕСКОЛЬКО занятий (расписание с несколькими занятиями в день или
  // перенос) — храним все, в ячейке дня каждое отмечается отдельно.
  const lessonsByGroupDay = new Map<
    string,
    {
      lessonId: string
      startTime: string
      rescheduledFromDate: Date | null
      attendances: typeof lessons[number]["attendances"]
    }[]
  >()
  for (const l of lessons) {
    const day = l.date.getUTCDate()
    const key = `${l.groupId}|${day}`
    const entry = {
      lessonId: l.id,
      startTime: l.startTime,
      rescheduledFromDate: l.rescheduledFromDate,
      attendances: l.attendances,
    }
    const list = lessonsByGroupDay.get(key)
    if (list) list.push(entry)
    else lessonsByGroupDay.set(key, [entry])
  }
  for (const list of lessonsByGroupDay.values()) {
    list.sort((a, b) => a.startTime.localeCompare(b.startTime))
  }

  // === Зачисления (дата = граница состава) ===
  // Активные + отчисленные/переведённые позже начала периода (withdrawnAt > rosterFrom),
  // чтобы выбывший в середине месяца показывался в ячейках ДО даты отчисления, а
  // после — пусто (граница применяется по дням ниже). isActive=false всегда с withdrawnAt.
  //
  // Окно выборки шире месяца, если есть занятия, перенесённые через его границу:
  // их состав судится по исходной дате (rescheduledFromDate), и ученик, отчисленный
  // к 1-му числу (или зачисленный после конца месяца), обязан попасть в выборку —
  // иначе его строка с этим занятием пропадает из сетки, хотя карточка занятия
  // его показывает. Лишние строки без единой ячейки отсекаются ниже.
  let rosterFrom = dateFrom
  let rosterTo: Date = dateTo
  for (const l of lessons) {
    const d = l.rescheduledFromDate ?? l.date
    if (d < rosterFrom) rosterFrom = d
    if (d > rosterTo) rosterTo = d
  }
  const enrollments = effectiveGroupIds.length > 0
    ? await db.groupEnrollment.findMany({
        where: {
          tenantId,
          deletedAt: null,
          groupId: { in: effectiveGroupIds },
          enrolledAt: { lte: rosterTo },
          ...rosterWhereOnDate(rosterFrom),
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

  // === Покрытие абонементом на дату (гейт как в карточке занятия) ===
  // Плановую (без отметки) ячейку показываем ТОЛЬКО если у ребёнка есть покрывающий
  // абонемент на дату состава (правило владельца 14.07: без покрытия занятие не
  // планируется — иначе «Был» уходит в разовое списание с баланса). Уже отмеченные
  // ячейки (включая разовые/выбывших) показываем всегда. Раньше сетка гейт НЕ применяла
  // и показывала ребёнка в «дыре покрытия» (напр. между двумя пакетами) — его можно было
  // ошибочно отметить. Матч по НАПРАВЛЕНИЮ (как в roster-filter), не по группе.
  const directionIds = Array.from(new Set(groups.map((g) => g.directionId)))
  const coverage = await buildCoverageResolver(db, tenantId, directionIds, rosterFrom, rosterTo)

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

    const cells: AttendanceCellData[][] = []
    let planCount = 0
    for (let day = 1; day <= daysInMonth; day++) {
      const dayLessons = lessonsByGroupDay.get(`${e.groupId}|${day}`) ?? []
      const dayCells: AttendanceCellData[] = []
      for (const lessonInfo of dayLessons) {
        // Граница состава: для перенесённого занятия — по исходной дате
        // (rescheduledFromDate), иначе по календарному дню ячейки. Так перенос на
        // более поздний день не показывает «плановым» ученика, начавшего позже.
        // enrolledAt/withdrawnAt — @db.Date (полночь UTC), как и эта дата, поэтому
        // день зачисления входит, а день withdrawnAt — нет (баг #8: зачисленный
        // в середине месяца не показывается с 1-го). Проверяем ПО КАЖДОМУ занятию:
        // у перенесённого и обычного занятия одного дня границы разные.
        const rosterDate = lessonInfo.rescheduledFromDate ?? new Date(Date.UTC(year, month - 1, day))
        if (!isEnrolledOnLesson(e, rosterDate)) continue
        const att = lessonInfo.attendances.find((a) => {
          if (a.clientId !== e.clientId) return false
          return (a.wardId || null) === (e.wardId || null)
        })
        // Гейт покрытия: плановую ячейку (без отметки) показываем только при наличии
        // покрывающего абонемента на дату. Уже отмеченные — всегда (см. коммент выше).
        if (!att && !coverage.isCoveredOn(e.clientId, e.wardId, g.directionId, rosterDate, lessonInfo.lessonId)) continue
        planCount++
        dayCells.push({
          lessonId: lessonInfo.lessonId,
          startTime: lessonInfo.startTime,
          attendanceId: att?.id ?? null,
          attendanceTypeCode: att && !att.isPending ? att.attendanceType.code : null,
          attendanceTypeName: att && !att.isPending ? att.attendanceType.name : null,
          isPending: !!att?.isPending,
        })
      }
      cells.push(dayCells)
    }

    // Строка без единой видимой ячейки (нет покрытых плановых занятий и нет отметок)
    // не показывается: сетка = агрегат составов карточек занятий за месяц. Так уходят
    // и пустые строки давно отчисленных, и зачисленные без покрытия (в «дыре» между
    // абонементами) — их в карточках занятий тоже нет.
    if (planCount === 0) continue

    rows.push({
      // e.id в ключе: у одной тройки (клиент, подопечный, группа) бывает два
      // зачисления (отчислили и снова зачислили) — без id ключи строк совпадут.
      key: `${e.clientId}|${e.wardId || ""}|${e.groupId}|${e.id}`,
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

  // === Пробные ученики (баг #42) ===
  // Лиды, записанные на пробное в группу, привязаны к реальному занятию группы
  // (TrialLesson.lessonId). Берём пробные тех занятий, что уже попали в сетку
  // (значит, прошли все фильтры — группа/филиал/направление/инструктор/«свои» у
  // инструктора), и добавляем строкой в их группу с ячейкой на дату пробного.
  // Индивидуальные пробные (без группы и без lessonId) в групповую сетку не
  // попадают — у них нет колонки группы.
  const lessonById = new Map(lessons.map((l) => [l.id, l]))
  const lessonIds = lessons.map((l) => l.id)
  const trialLessons = lessonIds.length > 0
    ? await db.trialLesson.findMany({
        where: {
          tenantId,
          lessonId: { in: lessonIds },
          status: { in: ["scheduled", "attended", "no_show"] },
        },
        select: {
          id: true,
          status: true,
          lessonId: true,
          clientId: true,
          wardId: true,
          client: { select: { firstName: true, lastName: true } },
          ward: { select: { firstName: true, lastName: true, birthDate: true } },
        },
      })
    : []

  const trialRowByKey = new Map<string, AttendanceRow>()
  for (const t of trialLessons) {
    const l = t.lessonId ? lessonById.get(t.lessonId) : null
    if (!l) continue
    const g = groupById.get(l.groupId)
    if (!g) continue
    const day = l.date.getUTCDate()
    const key = `trial|${t.clientId}|${t.wardId || ""}|${l.groupId}`
    let row = trialRowByKey.get(key)
    if (!row) {
      const parent = clientName(t.client)
      const contragentLabel = t.ward
        ? clientName({ firstName: t.ward.firstName, lastName: t.ward.lastName })
        : parent
      row = {
        key,
        clientId: t.clientId,
        wardId: t.wardId,
        contragentLabel,
        parentLabel: t.ward ? parent : null,
        birthDate: t.ward?.birthDate ? t.ward.birthDate.toISOString().slice(0, 10) : null,
        toPayAmount: null,
        groupName: g.name,
        instructorLabel: instructorShortName(g.instructor),
        planCount: 0,
        cells: Array.from({ length: daysInMonth }, (): AttendanceCellData[] => []),
        isTrial: true,
      }
      trialRowByKey.set(key, row)
    }
    row.cells[day - 1].push({
      lessonId: l.id,
      startTime: l.startTime,
      attendanceId: null,
      attendanceTypeCode: null,
      attendanceTypeName: null,
      isPending: false,
      isTrial: true,
      trialId: t.id,
      trialStatus: t.status as "scheduled" | "attended" | "no_show",
    })
    row.planCount++
  }
  // Стопка пробных в ячейке дня — в том же порядке, что у обычных строк (по
  // времени начала): запрос trialLessons идёт без orderBy, порядок выдачи БД
  // нестабилен, а позиция саб-ячейки должна совпадать со строками учеников.
  for (const row of trialRowByKey.values()) {
    for (const dayCells of row.cells) {
      if (dayCells.length > 1) dayCells.sort((a, b) => a.startTime.localeCompare(b.startTime))
    }
  }
  rows.push(...trialRowByKey.values())

  // Сортировка: сначала по группе, потом по ФИО контрагента
  rows.sort((a, b) => {
    const c1 = a.groupName.localeCompare(b.groupName, "ru")
    if (c1 !== 0) return c1
    return a.contragentLabel.localeCompare(b.contragentLabel, "ru")
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 gap-y-2">
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
        canMarkTrials={role !== "readonly"}
      />
    </div>
  )
}
