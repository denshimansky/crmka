import { type Prisma, type PrismaClient } from "@prisma/client"

type DB = PrismaClient | Prisma.TransactionClient

/**
 * Блокировка отчисления абонемента по статусу занятия (матрица «Виды посещений»
 * → колонка «Разрешить отчисление», поле AttendanceType.allowSubscriptionWithdrawal).
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
  const blockers = await db.attendance.findMany({
    where: {
      tenantId,
      subscriptionId,
      attendanceType: { allowSubscriptionWithdrawal: false },
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
