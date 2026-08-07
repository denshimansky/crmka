import type { PrismaClient } from "@prisma/client"
import { phoneMatchKey } from "@/lib/phone"

export interface PhoneMatchClient {
  id: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  phone2: string | null
  funnelStatus: string
  clientStatus: string | null
}

/**
 * Клиенты тенанта, чей `phone` ИЛИ `phone2` совпадает с `input` по последним N
 * цифрам (N = длина ключа, ≤10). Нормализация — на стороне БД: `regexp_replace`
 * убирает всё кроме цифр у ХРАНИМОГО значения, поэтому «+7 (999) 12-34-56»,
 * «89991234 56» и «7 999 123456» матчатся одинаково. Раньше проверки делали
 * `phone contains <только-цифры>` по сырой строке — форматированные номера
 * (с пробелами/скобками) не находились, и дубли проходили.
 *
 * Возвращает [] если во входе меньше 7 цифр. `excludeId` — исключить самого
 * клиента (проверка дубля при редактировании). Единая точка для жёсткого
 * запрета (POST /api/clients) и живой подсказки (check-duplicate).
 */
export async function findClientsByPhone(
  db: PrismaClient,
  tenantId: string,
  input: string,
  opts: { excludeId?: string; limit?: number } = {},
): Promise<PhoneMatchClient[]> {
  const key = phoneMatchKey(input)
  if (!key) return []
  const keyLen = key.length
  const limit = opts.limit ?? 5
  const excludeId = opts.excludeId ?? null

  return db.$queryRaw<PhoneMatchClient[]>`
    SELECT id,
           first_name          AS "firstName",
           last_name           AS "lastName",
           phone,
           phone2,
           funnel_status::text AS "funnelStatus",
           client_status::text AS "clientStatus"
    FROM clients
    WHERE tenant_id = ${tenantId}::uuid
      AND deleted_at IS NULL
      AND (${excludeId}::uuid IS NULL OR id <> ${excludeId}::uuid)
      AND (
        (    length(regexp_replace(coalesce(phone,  ''), '[^0-9]', '', 'g')) >= ${keyLen}::int
         AND right(regexp_replace(coalesce(phone,  ''), '[^0-9]', '', 'g'), ${keyLen}::int) = ${key})
        OR
        (    length(regexp_replace(coalesce(phone2, ''), '[^0-9]', '', 'g')) >= ${keyLen}::int
         AND right(regexp_replace(coalesce(phone2, ''), '[^0-9]', '', 'g'), ${keyLen}::int) = ${key})
      )
    LIMIT ${limit}::int
  `
}
