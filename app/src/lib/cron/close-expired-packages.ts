import { db } from "@/lib/db"
import { recalcClientDiscounts } from "@/lib/discounts/recalc-client-discounts"

/**
 * Закрывает все пакетные абонементы, у которых истёк срок (expiresAt < today).
 * Остаток balance сгорает — переходит в выручку. Возврат на баланс клиента —
 * только вручную через дополнительную операцию (см. UI ручного продления).
 *
 * Lesson posting в attendance route уже фильтрует по expiresAt >= lessonDate,
 * так что после истечения новые списания невозможны. Этот cron нужен для
 * корректного status='closed' и endDate, чтобы отчёты не отображали
 * истёкший пакет как «активный».
 *
 * Также по закрытым абонементам пересчитываем шаблонные linked-скидки клиента
 * — у других подопечных условие могло перестать выполняться.
 */
export async function closeExpiredPackages(now: Date = new Date()) {
  // Берём начало текущего дня (UTC) — пакет с expiresAt = вчера должен закрыться.
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  // Сначала собираем кандидатов, чтобы потом дёрнуть recalculate по клиентам.
  const candidates = await db.subscription.findMany({
    where: {
      type: "package",
      status: { in: ["active", "pending"] },
      expiresAt: { lt: today },
      deletedAt: null,
    },
    select: { id: true, clientId: true, tenantId: true },
  })
  if (candidates.length === 0) return { closed: 0 }

  await db.subscription.updateMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    data: { status: "closed", endDate: today },
  })

  // Пересчёт шаблонных скидок — по каждому затронутому клиенту, в своей
  // мини-транзакции. Один клиент может фигурировать дважды → дедупликация.
  const seen = new Set<string>()
  for (const c of candidates) {
    const key = `${c.tenantId}:${c.clientId}`
    if (seen.has(key)) continue
    seen.add(key)
    await db.$transaction(async (tx) => {
      await recalcClientDiscounts(tx, {
        tenantId: c.tenantId,
        clientId: c.clientId,
        createdBy: null,
      })
    })
  }

  return { closed: candidates.length }
}
