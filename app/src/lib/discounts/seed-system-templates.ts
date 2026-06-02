// Ленивый seed двух системных шаблонов скидок для тенанта.
// Срабатывает при первом обращении к /api/discount-templates GET и
// при загрузке списка из карточки клиента. Идемпотентен (uniq по
// tenantId+systemKey, см. миграцию).

import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"

const SYSTEM_TEMPLATES: Array<{
  systemKey: string
  name: string
  kind: "linked_sibling" | "linked_second_direction"
}> = [
  { systemKey: "linked_sibling", name: "За 2-го ребёнка", kind: "linked_sibling" },
  {
    systemKey: "linked_second_direction",
    name: "За 2-е направление",
    kind: "linked_second_direction",
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
          // type — наследие старой схемы; для linked_* пишем `linked`.
          type: "linked",
          valueType: "percent",
          value: new Prisma.Decimal(0),
          isActive: false,
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
