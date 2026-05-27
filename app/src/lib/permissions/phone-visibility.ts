import { db } from "@/lib/db"

const MASK = "•••••"

/**
 * Маскирует телефон для инструктора, если в настройках организации включена опция
 * «скрывать номера у инструктора». Для остальных ролей возвращает номер как есть.
 *
 * Использовать на серверной стороне (API + server components), до отправки данных
 * клиенту — иначе номер можно прочитать в Network-вкладке браузера.
 */
export function maskPhone(
  phone: string | null | undefined,
  role: string,
  hideFromInstructors: boolean,
): string | null {
  if (!phone) return null
  if (hideFromInstructors && role === "instructor") return MASK
  return phone
}

/**
 * Возвращает true, если пользователь имеет право выгружать список клиентов.
 * При выключенном ограничении — true для всех. При включённом — только owner.
 */
export function canExportClients(role: string, restrict: boolean): boolean {
  if (!restrict) return true
  return role === "owner"
}

/**
 * Хелпер: одним запросом достаёт настройки видимости для текущего тенанта.
 * Кэширование не требуется — Prisma client сам её мемоизирует на запрос.
 */
export async function getVisibilitySettings(tenantId: string): Promise<{
  hidePhonesFromInstructors: boolean
  restrictClientExport: boolean
}> {
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { hidePhonesFromInstructors: true, restrictClientExport: true },
  })
  return {
    hidePhonesFromInstructors: org?.hidePhonesFromInstructors ?? false,
    restrictClientExport: org?.restrictClientExport ?? false,
  }
}
