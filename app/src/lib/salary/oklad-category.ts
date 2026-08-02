import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"

/** Системная категория расхода, в которую падают выплаты окладов (твин). */
export const OKLAD_EXPENSE_CATEGORY_NAME = "Зарплата окладников"

/**
 * id системной категории оклад-расхода. Категория засеяна миграцией
 * (tenant_id=NULL), поэтому обычно возвращается сразу. Фолбэк-create на случай
 * свежей БД до сида. Резолвить нужно ДО money-транзакции: при гонке партиал-UNIQUE
 * (expense_categories_system_name_key, tenant_id IS NULL) отобьёт вторую вставку с
 * P2002 — здесь мы это перехватываем и перечитываем; внутри транзакции это было бы
 * невозможно (Postgres помечает всю tx как aborted после нарушения ограничения).
 */
export async function getOkladCategoryId(): Promise<string> {
  const existing = await db.expenseCategory.findFirst({
    where: { name: OKLAD_EXPENSE_CATEGORY_NAME, tenantId: null },
    select: { id: true },
  })
  if (existing) return existing.id
  try {
    const created = await db.expenseCategory.create({
      data: {
        tenantId: null,
        name: OKLAD_EXPENSE_CATEGORY_NAME,
        isSalary: true,
        isVariable: false,
        isSystem: true,
        isActive: true,
        sortOrder: 14,
      },
      select: { id: true },
    })
    return created.id
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await db.expenseCategory.findFirst({
        where: { name: OKLAD_EXPENSE_CATEGORY_NAME, tenantId: null },
        select: { id: true },
      })
      if (again) return again.id
    }
    throw e
  }
}
