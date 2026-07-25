import { type Prisma, type PrismaClient } from "@prisma/client"

type DB = PrismaClient | Prisma.TransactionClient

/**
 * Оверрайды флага «Разрешить отчисление» текущей организации для СИСТЕМНЫХ
 * (глобальных) видов посещений: Map<attendanceTypeId, allowSubscriptionWithdrawal>.
 * Общая строка одна на весь SaaS, поэтому персональное значение центра хранится в
 * attendance_type_withdrawal_overrides. Отсутствие ключа = наследуется дефолт с
 * AttendanceType.allowSubscriptionWithdrawal. Используется и в enforcement, и при
 * отдаче матрицы в UI (GET /api/attendance-types), чтобы логика не разъехалась.
 */
export async function getWithdrawalOverrideMap(
  db: DB,
  tenantId: string,
): Promise<Map<string, boolean>> {
  const overrides = await db.attendanceTypeWithdrawalOverride.findMany({
    where: { tenantId },
    select: { attendanceTypeId: true, allowSubscriptionWithdrawal: true },
  })
  return new Map(overrides.map((o) => [o.attendanceTypeId, o.allowSubscriptionWithdrawal]))
}

/**
 * Пер-организационные оверрайды СИСТЕМНЫХ (глобальных) видов посещений этой
 * организации: Map<attendanceTypeId, значения>. Общая строка одна на весь SaaS,
 * поэтому персональные значения центра (доступ роли, отключение, отчисление)
 * живут здесь. Отсутствие ключа = все дефолты наследуются со строки типа.
 */
export interface AttendanceTypeOverride {
  allowSubscriptionWithdrawal: boolean
  isDisabled: boolean
  availableToInstructor: boolean | null
  availableToAdmin: boolean | null
}

export async function getAttendanceTypeOverrideMap(
  db: DB,
  tenantId: string,
): Promise<Map<string, AttendanceTypeOverride>> {
  const rows = await db.attendanceTypeWithdrawalOverride.findMany({
    where: { tenantId },
    select: {
      attendanceTypeId: true,
      allowSubscriptionWithdrawal: true,
      isDisabled: true,
      availableToInstructor: true,
      availableToAdmin: true,
    },
  })
  return new Map(
    rows.map((r) => [
      r.attendanceTypeId,
      {
        allowSubscriptionWithdrawal: r.allowSubscriptionWithdrawal,
        isDisabled: r.isDisabled,
        availableToInstructor: r.availableToInstructor,
        availableToAdmin: r.availableToAdmin,
      },
    ]),
  )
}

/**
 * Накладывает пер-организационный оверрайд на системный тип: возвращает
 * ЭФФЕКТИВНЫЕ availableToInstructor/availableToAdmin центра и признак
 * isDisabledForTenant (скрыт ли тип у этой организации). Для кастомных типов
 * (оверрайда нет) — значения строки как есть. Используется во всех выпадашках
 * отметки, чтобы настройка одного центра не влияла на других (баг #82).
 */
export function applyAttendanceOverride<
  T extends { availableToInstructor: boolean; availableToAdmin: boolean },
>(t: T, ov: AttendanceTypeOverride | undefined): T & { isDisabledForTenant: boolean } {
  if (!ov) return { ...t, isDisabledForTenant: false }
  return {
    ...t,
    availableToInstructor: ov.availableToInstructor ?? t.availableToInstructor,
    availableToAdmin: ov.availableToAdmin ?? t.availableToAdmin,
    isDisabledForTenant: ov.isDisabled,
  }
}

/**
 * Множество id видов посещений, у которых с учётом пер-организационного оверрайда
 * отчисление ЗАПРЕЩЕНО (эффективный allowSubscriptionWithdrawal = false).
 * Эффективное значение = оверрайд организации, если он есть, иначе дефолт типа.
 */
export async function getDisallowedWithdrawalTypeIds(
  db: DB,
  tenantId: string,
): Promise<Set<string>> {
  const [types, overrideMap] = await Promise.all([
    db.attendanceType.findMany({
      where: { OR: [{ tenantId: null }, { tenantId }] },
      select: { id: true, allowSubscriptionWithdrawal: true },
    }),
    getWithdrawalOverrideMap(db, tenantId),
  ])
  const disallowed = new Set<string>()
  for (const t of types) {
    const effective = overrideMap.has(t.id) ? overrideMap.get(t.id)! : t.allowSubscriptionWithdrawal
    if (!effective) disallowed.add(t.id)
  }
  return disallowed
}

/**
 * Блокировка отчисления абонемента по статусу занятия (матрица «Виды посещений»
 * → колонка «Разрешить отчисление», поле AttendanceType.allowSubscriptionWithdrawal
 * с учётом пер-организационного оверрайда, см. getDisallowedWithdrawalTypeIds).
 *
 * Если у абонемента есть отметка с типом, где флаг снят (напр. «Назначена
 * отработка»), отчислять нельзя, пока обязательство не закрыто. Возвращает текст
 * ошибки для 409 или null, если отчисление разрешено.
 *
 * Исключение — «Назначена отработка», по которой отработка УЖЕ проведена (есть
 * реальная отработка: Attendance.makeupOfLessonId = это занятие). Такое
 * обязательство закрыто и не блокирует. Проверяем именно по наличию реальной
 * отработки, а НЕ по chargeAmount > 0: у бесплатного абонемента (цена/скидка = 0)
 * проведённая отработка несёт chargeAmount = 0 и иначе блокировала бы навсегда.
 * makeupOfLessonId проставляется только на успешной отработке («Был» + isMakeup),
 * а «Не был» (Ф8) удаляет запись — поэтому её наличие = отработка состоялась.
 * Для новых отметок исходная строка вообще переведена в «Отработано» (см.
 * attendance POST), но у legacy-данных могла остаться «Назначена отработка».
 */
export async function getWithdrawalBlockReason(
  db: DB,
  tenantId: string,
  subscriptionId: string,
): Promise<string | null> {
  const disallowedTypeIds = await getDisallowedWithdrawalTypeIds(db, tenantId)
  if (disallowedTypeIds.size === 0) return null

  const blockers = await db.attendance.findMany({
    where: {
      tenantId,
      subscriptionId,
      attendanceTypeId: { in: [...disallowedTypeIds] },
    },
    select: {
      lessonId: true,
      clientId: true,
      wardId: true,
      attendanceType: { select: { name: true, code: true } },
    },
  })

  for (const b of blockers) {
    if (b.attendanceType.code === "makeup_scheduled") {
      const resolved = await db.attendance.findFirst({
        where: {
          tenantId,
          makeupOfLessonId: b.lessonId,
          clientId: b.clientId,
          wardId: b.wardId,
        },
        select: { id: true },
      })
      if (resolved) continue
    }
    return b.attendanceType.code === "makeup_scheduled"
      ? "Нельзя отчислить: у ученика есть незакрытая отработка. Сначала проведите её («Был» на занятии-отработке) или отмените."
      : `Нельзя отчислить: на занятии стоит статус «${b.attendanceType.name}», по которому отчисление запрещено. Измените статус или разрешите отчисление в настройках видов посещений.`
  }

  return null
}
