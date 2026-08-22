import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { WITHDRAWAL_LOCKED_CODES } from "@/lib/subscriptions/withdrawal-block"
import { logAudit } from "@/lib/audit"
import { z } from "zod"

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  chargesSubscription: z.boolean().optional(),
  paysInstructor: z.boolean().optional(),
  countsAsRevenue: z.boolean().optional(),
  availableToInstructor: z.boolean().optional(),
  availableToAdmin: z.boolean().optional(),
  partOfPlan: z.boolean().optional(),
  partOfFact: z.boolean().optional(),
  partOfForecast: z.boolean().optional(),
  chargePercent: z.number().int().min(0).max(100).optional(),
  allowSubscriptionWithdrawal: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

// Поля, которые разрешено менять у залоченного (isFlagsLocked=true) системного типа
// ПРЯМО В ОБЩЕЙ СТРОКЕ. Семантика поведения зафиксирована, доступ к ролям — настраивается
// каждым центром. «Разрешить отчисление» (allowSubscriptionWithdrawal) сюда НЕ входит и
// не пишется в общую строку: у системных типов оно настраивается пер-организационно через
// оверрайд (attendance_type_withdrawal_overrides), перехватывается ВЫШЕ в PATCH до этого
// guard'а. Иначе один центр заблокировал бы отчисление во всех остальных (напр. сняв
// флаг у «Был»). Дефолт для системных задаёт сид (makeup_scheduled=false, остальные=true).
const LOCKED_ALLOWED_FIELDS = new Set([
  "availableToInstructor",
  "availableToAdmin",
  "isActive",
  "sortOrder",
])

// Системные типы, которые организации разрешено отключать у себя (баг #82).
// Остальные системные типы структурные («Был», «Не был», отработки, «Перерасчёт»)
// — их отключение сломало бы бизнес-логику, поэтому запрещено.
const DISABLEABLE_SYSTEM_CODES = new Set(["excused", "absent"])

// Занятия, на которых в этой организации стоит указанный тип посещения — для
// сообщения «нельзя отключить, есть отметки» (баг #82). Группируем отметки по
// занятию; возвращаем итоги и первые 50 занятий (с датой, группой, направлением).
async function getTypeUsageLessons(tenantId: string, attendanceTypeId: string) {
  const marks = await db.attendance.findMany({
    where: { tenantId, attendanceTypeId },
    select: {
      lessonId: true,
      lesson: {
        select: {
          id: true,
          date: true,
          startTime: true,
          group: { select: { name: true, direction: { select: { name: true } } } },
        },
      },
    },
    orderBy: { lesson: { date: "desc" } },
  })

  const byLesson = new Map<
    string,
    { lessonId: string; date: string; startTime: string; groupName: string; directionName: string; count: number }
  >()
  for (const m of marks) {
    if (!m.lesson) continue
    const cur = byLesson.get(m.lessonId)
    if (cur) {
      cur.count++
    } else {
      byLesson.set(m.lessonId, {
        lessonId: m.lesson.id,
        date: m.lesson.date.toISOString().slice(0, 10),
        startTime: m.lesson.startTime,
        groupName: m.lesson.group.name,
        directionName: m.lesson.group.direction.name,
        count: 1,
      })
    }
  }
  const lessons = [...byLesson.values()]
  return { totalMarks: marks.length, totalLessons: lessons.length, lessons: lessons.slice(0, 50) }
}

// PATCH /api/attendance-types/[id] — обновить тип посещения
// Системные строки (tenantId=null): можно менять name/флаги/isActive/sortOrder, нельзя code.
// Кастомные: владелец/управляющий своего тенанта.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = (session.user as any).tenantId

  const existing = await db.attendanceType.findFirst({
    where: {
      id,
      OR: [{ tenantId: null }, { tenantId }],
    },
  })
  if (!existing) return NextResponse.json({ error: "Тип не найден" }, { status: 404 })

  const body = await request.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  // «Разрешить отчисление» у СИСТЕМНОГО (глобального, tenantId=null) типа пишем НЕ в
  // общую строку, а в пер-организационный оверрайд — иначе один центр менял бы правило
  // отчисления у всех. У кастомных типов поле по-прежнему живёт в самой колонке.
  const isGlobal = existing.tenantId === null
  let withdrawalChange: { old: boolean; new: boolean } | null = null
  // Залоченные коды — запрет отчисления зашит в систему, центру его не снять
  // (см. WITHDRAWAL_LOCKED_CODES). Проверяем до ветки isGlobal: кастомный тип с
  // таким кодом завести нельзя, но если он как-то появится — правило то же.
  if (
    parsed.data.allowSubscriptionWithdrawal !== undefined &&
    WITHDRAWAL_LOCKED_CODES.has(existing.code)
  ) {
    return NextResponse.json(
      {
        error:
          existing.code === "makeup_scheduled"
            ? "«Назначена отработка» всегда блокирует отчисление — этот статус изменить нельзя."
            : "«Не был» всегда блокирует отчисление: это промежуточный статус, сначала нужно уточнить причину пропуска. Изменить нельзя.",
      },
      { status: 403 },
    )
  }
  if (isGlobal && parsed.data.allowSubscriptionWithdrawal !== undefined) {
    const val = parsed.data.allowSubscriptionWithdrawal
    const prev = await db.attendanceTypeWithdrawalOverride.findUnique({
      where: { tenantId_attendanceTypeId: { tenantId, attendanceTypeId: id } },
      select: { allowSubscriptionWithdrawal: true },
    })
    const oldEffective = prev ? prev.allowSubscriptionWithdrawal : existing.allowSubscriptionWithdrawal
    if (oldEffective !== val) {
      await db.attendanceTypeWithdrawalOverride.upsert({
        where: { tenantId_attendanceTypeId: { tenantId, attendanceTypeId: id } },
        create: { tenantId, attendanceTypeId: id, allowSubscriptionWithdrawal: val },
        update: { allowSubscriptionWithdrawal: val },
      })
      withdrawalChange = { old: oldEffective, new: val }
    }
    // Дальше по общей строке это поле не трогаем (и не даём guard'у его завернуть).
    parsed.data.allowSubscriptionWithdrawal = undefined
  }

  // «Активен» (скрыть/показать тип в выпадашках) у СИСТЕМНОГО (глобального) типа —
  // тоже пер-организационный оверрайд (is_disabled), а не общая строка: иначе один
  // центр скрыл бы тип у всех. Разрешено только для «Уваж. пропуск»/«Прогул» (баг #82).
  let activeChange: { old: boolean; new: boolean } | null = null
  if (isGlobal && parsed.data.isActive !== undefined) {
    if (!DISABLEABLE_SYSTEM_CODES.has(existing.code)) {
      return NextResponse.json(
        { error: "Этот системный тип нельзя отключить." },
        { status: 403 },
      )
    }
    const nextActive = parsed.data.isActive
    const prevOv = await db.attendanceTypeWithdrawalOverride.findUnique({
      where: { tenantId_attendanceTypeId: { tenantId, attendanceTypeId: id } },
      select: { isDisabled: true },
    })
    const oldActive = !(prevOv?.isDisabled ?? false)
    if (oldActive !== nextActive) {
      // Отключение запрещено, если по типу в этой организации уже есть отметки —
      // сначала их нужно переставить (баг #82). Отдаём список занятий для UI.
      if (nextActive === false) {
        const usage = await getTypeUsageLessons(tenantId, id)
        if (usage.totalMarks > 0) {
          return NextResponse.json(
            {
              error: `Нельзя отключить «${existing.name}»: по нему уже есть отметки (${usage.totalMarks}). Сначала переставьте их на других занятиях.`,
              lessons: usage.lessons,
              totalLessons: usage.totalLessons,
              totalMarks: usage.totalMarks,
            },
            { status: 409 },
          )
        }
      }
      await db.attendanceTypeWithdrawalOverride.upsert({
        where: { tenantId_attendanceTypeId: { tenantId, attendanceTypeId: id } },
        create: {
          tenantId,
          attendanceTypeId: id,
          allowSubscriptionWithdrawal: existing.allowSubscriptionWithdrawal,
          isDisabled: !nextActive,
        },
        update: { isDisabled: !nextActive },
      })
      activeChange = { old: oldActive, new: nextActive }
    }
    // Общую строку isActive не трогаем (и guard её не должен заворачивать).
    parsed.data.isActive = undefined
  }

  // «Доступно инструктору»/«Доступно админу» у СИСТЕМНОГО (глобального) типа —
  // тоже пер-организационный оверрайд (nullable: NULL = наследуется дефолт строки),
  // иначе один центр менял бы доступ роли к типу во всех остальных.
  const availabilityChanges: Record<string, { old: boolean; new: boolean }> = {}
  if (
    isGlobal &&
    (parsed.data.availableToInstructor !== undefined || parsed.data.availableToAdmin !== undefined)
  ) {
    const prevOv = await db.attendanceTypeWithdrawalOverride.findUnique({
      where: { tenantId_attendanceTypeId: { tenantId, attendanceTypeId: id } },
      select: { availableToInstructor: true, availableToAdmin: true },
    })
    const upsertData: { availableToInstructor?: boolean; availableToAdmin?: boolean } = {}
    for (const field of ["availableToInstructor", "availableToAdmin"] as const) {
      const val = parsed.data[field]
      if (val === undefined) continue
      const oldEffective = prevOv?.[field] ?? existing[field]
      if (oldEffective !== val) {
        upsertData[field] = val
        availabilityChanges[field] = { old: oldEffective, new: val }
      }
      // По общей строке эти поля у системного типа не пишем.
      parsed.data[field] = undefined
    }
    if (Object.keys(upsertData).length > 0) {
      await db.attendanceTypeWithdrawalOverride.upsert({
        where: { tenantId_attendanceTypeId: { tenantId, attendanceTypeId: id } },
        create: {
          tenantId,
          attendanceTypeId: id,
          allowSubscriptionWithdrawal: existing.allowSubscriptionWithdrawal,
          ...upsertData,
        },
        update: upsertData,
      })
    }
  }

  // Для залоченных типов разрешаем только настройки доступа к ролям/видимости.
  if (existing.isFlagsLocked) {
    const offendingField = Object.keys(parsed.data).find(
      (k) => parsed.data[k as keyof typeof parsed.data] !== undefined && !LOCKED_ALLOWED_FIELDS.has(k),
    )
    if (offendingField) {
      return NextResponse.json(
        { error: "У этого типа можно менять только доступ к ролям и видимость — остальное зашито в бизнес-логику." },
        { status: 403 }
      )
    }
  }

  const data: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) data.name = parsed.data.name
  if (parsed.data.chargesSubscription !== undefined) data.chargesSubscription = parsed.data.chargesSubscription
  if (parsed.data.paysInstructor !== undefined) data.paysInstructor = parsed.data.paysInstructor
  if (parsed.data.countsAsRevenue !== undefined) data.countsAsRevenue = parsed.data.countsAsRevenue
  if (parsed.data.availableToInstructor !== undefined) data.availableToInstructor = parsed.data.availableToInstructor
  if (parsed.data.availableToAdmin !== undefined) data.availableToAdmin = parsed.data.availableToAdmin
  if (parsed.data.partOfPlan !== undefined) data.partOfPlan = parsed.data.partOfPlan
  if (parsed.data.partOfFact !== undefined) data.partOfFact = parsed.data.partOfFact
  if (parsed.data.partOfForecast !== undefined) data.partOfForecast = parsed.data.partOfForecast
  if (parsed.data.chargePercent !== undefined) data.chargePercent = parsed.data.chargePercent
  // allowSubscriptionWithdrawal у кастомных типов пишем прямо в колонку (у системных
  // оно уже перехвачено в оверрайд выше и здесь undefined).
  if (parsed.data.allowSubscriptionWithdrawal !== undefined) data.allowSubscriptionWithdrawal = parsed.data.allowSubscriptionWithdrawal
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive
  if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder

  const updated = Object.keys(data).length > 0
    ? await db.attendanceType.update({ where: { id }, data })
    : existing

  // Ответ отдаём с ЭФФЕКТИВНЫМ «Разрешить отчисление» центра: для системного типа это
  // его оверрайд, а не глобальный дефолт — иначе оптимистичный setState в UI (patchField)
  // показал бы чужое значение (в т.ч. при правке другого поля системного типа).
  let response: Record<string, unknown> = updated
  if (isGlobal) {
    const ov = await db.attendanceTypeWithdrawalOverride.findUnique({
      where: { tenantId_attendanceTypeId: { tenantId, attendanceTypeId: id } },
      select: {
        allowSubscriptionWithdrawal: true,
        isDisabled: true,
        availableToInstructor: true,
        availableToAdmin: true,
      },
    })
    if (ov) {
      response = {
        ...updated,
        allowSubscriptionWithdrawal: ov.allowSubscriptionWithdrawal,
        availableToInstructor: ov.availableToInstructor ?? updated.availableToInstructor,
        availableToAdmin: ov.availableToAdmin ?? updated.availableToAdmin,
        isActive: !ov.isDisabled,
      }
    }
  }

  // Аудит: справочник влияет на видимость типов во всех выпадашках отметки —
  // без записи невозможно восстановить, кто и когда снял/вернул флаг (баг
  // 02.07.2026: у трёх системных типов оказался снят «Доступно админу», а
  // датировать изменение было нечем).
  const changes: Record<string, { old: unknown; new: unknown }> = {}
  for (const key of Object.keys(data)) {
    changes[key] = {
      old: (existing as Record<string, unknown>)[key],
      new: data[key],
    }
  }
  if (withdrawalChange) {
    changes.allowSubscriptionWithdrawal = { old: withdrawalChange.old, new: withdrawalChange.new }
  }
  if (activeChange) {
    changes.isActive = { old: activeChange.old, new: activeChange.new }
  }
  for (const [k, v] of Object.entries(availabilityChanges)) {
    changes[k] = v
  }
  if (Object.keys(changes).length > 0) {
    logAudit({
      tenantId,
      employeeId: (session.user as any).employeeId,
      action: "update",
      entityType: "AttendanceType",
      entityId: id,
      changes,
      req: request,
    })
  }

  return NextResponse.json(response)
}

// DELETE /api/attendance-types/[id] — удалить кастомный тип
// Системные нельзя удалять (только деактивировать через PATCH isActive=false).
// Кастомный удаляется только если по нему нет ни одной Attendance — иначе 409.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = (session.user as any).tenantId

  const existing = await db.attendanceType.findFirst({ where: { id, tenantId } })
  if (!existing) {
    return NextResponse.json(
      { error: "Тип не найден или системный (системные нельзя удалить)" },
      { status: 404 }
    )
  }

  const usedCount = await db.attendance.count({ where: { attendanceTypeId: id } })
  if (usedCount > 0) {
    return NextResponse.json(
      {
        error: `По этому типу есть ${usedCount} ${usedCount === 1 ? "отметка" : "отметок"}. Деактивируйте тип вместо удаления.`,
      },
      { status: 409 }
    )
  }

  await db.attendanceType.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
