// Семантика «занятие абонемента израсходовано» (consumed slot).
//
// Расходуют занятие:
//   - все СПИСЫВАЮЩИЕ отметки (chargesSubscription=true): Был, Прогул, кастомные;
//   - финальные НЕсписывающие отметки: Уваж. пропуск (excused), Перерасчёт
//     (recalculation) и кастомные несписывающие типы — клиент за это занятие
//     НЕ платит, и оно больше не ожидает списания.
// НЕ расходуют занятие (слот остаётся «в ожидании»):
//   - no_show («Не был») — промежуточный статус, оператор позже уточнит причину;
//   - makeup_scheduled («Назначена отработка») — списание произойдёт на отработке;
//   - makeup («Отработано»-маркер) — деньги двигает реальная отработка (present
//     с isMakeup=true), маркер лишь ссылка на неё.
//
// ВАЖНО: семантика действует только для КАЛЕНДАРНЫХ абонементов. У пакетных
// уважительный пропуск занятие НЕ сжигает (пакет остаётся клиенту), поэтому
// для type=package расход считается только по списывающим отметкам.
//
// Денежная модель (recalc-client-discounts.ts):
//   finalAmount = chargedAmount + (totalLessons − consumed) × эффективная цена.
// До этого фикса consumed считался только по списывающим отметкам, из-за чего
// «Уваж. пропуск» оставлял фантомный долг: система продолжала ждать оплату
// за пропущенное занятие (баг карточки Самотейкина, 07.07.2026).

import type { Prisma } from "@prisma/client"

/** Несписывающие коды, которые НЕ расходуют занятие. */
export const NON_CONSUMING_CODES = ["no_show", "makeup_scheduled", "makeup"]

/** where-фрагмент AttendanceType: отметка расходует занятие календарного абонемента. */
export const consumingAttendanceTypeWhere: Prisma.AttendanceTypeWhereInput = {
  OR: [
    { chargesSubscription: true },
    { code: { notIn: NON_CONSUMING_CODES } },
  ],
}

/** where-фрагмент AttendanceType с учётом типа абонемента. */
export function consumedTypeWhereFor(subType: string): Prisma.AttendanceTypeWhereInput {
  return subType === "package"
    ? { chargesSubscription: true }
    : consumingAttendanceTypeWhere
}

/** Является ли тип посещения расходующим занятие (для календарного абонемента). */
export function isConsumingAttendanceType(type: {
  chargesSubscription: boolean
  code: string
}): boolean {
  return type.chargesSubscription || !NON_CONSUMING_CODES.includes(type.code)
}
