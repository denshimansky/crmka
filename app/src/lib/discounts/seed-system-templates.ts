// Ленивый seed системных шаблонов скидок для тенанта (Скидки v2).
// Срабатывает при первом обращении к /api/discount-templates GET и
// при загрузке списка из карточки клиента. Идемпотентен (uniq по
// tenantId+systemKey, см. миграцию).
//
// Набор (docs/discounts-v2.md §1):
//  - тип 1 «Скидка за второй абонемент» — автоматическая, создаётся
//    ВЫКЛЮЧЕННОЙ (фикс 50 ₽/занятие), организация включает сама;
//  - тип 2 «Постоянная скидка» — пример постоянного шаблона для ручного
//    выбора в карточке (10%); применяется только при явном выборе.

import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { TYPE1_SYSTEM_KEY } from "@/lib/discounts/recalc-client-discounts"

const SYSTEM_TEMPLATES: Array<{
  systemKey: string
  name: string
  kind: "second_subscription" | "permanent"
  type: "second_subscription" | "permanent"
  valueType: "percent" | "fixed"
  value: number
  isActive: boolean
}> = [
  {
    systemKey: TYPE1_SYSTEM_KEY,
    name: "Скидка за второй абонемент",
    kind: "second_subscription",
    type: "second_subscription",
    valueType: "fixed",
    value: 50,
    isActive: false,
  },
  {
    systemKey: "permanent_default",
    name: "Постоянная скидка",
    kind: "permanent",
    type: "permanent",
    valueType: "percent",
    value: 10,
    isActive: true,
  },
]

export async function ensureSystemDiscountTemplates(tenantId: string): Promise<void> {
  for (const t of SYSTEM_TEMPLATES) {
    try {
      await db.discountTemplate.create({
        data: {
          tenantId,
          name: t.name,
          kind: t.kind,
          systemKey: t.systemKey,
          type: t.type,
          valueType: t.valueType,
          value: new Prisma.Decimal(t.value),
          isActive: t.isActive,
          isStackable: false,
        },
      })
    } catch (e) {
      // unique violation = шаблон уже создан, это норма для второго+ вызова.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue
      throw e
    }
  }
}
