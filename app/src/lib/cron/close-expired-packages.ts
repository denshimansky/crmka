import { db } from "@/lib/db"

/**
 * Закрывает все пакетные абонементы, у которых истёк срок (expiresAt < today).
 * Остаток balance сгорает — переходит в выручку. Возврат на баланс клиента —
 * только вручную через дополнительную операцию (см. UI ручного продления).
 *
 * Lesson posting в attendance route уже фильтрует по expiresAt >= lessonDate,
 * так что после истечения новые списания невозможны. Этот cron нужен для
 * корректного status='closed' и endDate, чтобы отчёты не отображали
 * истёкший пакет как «активный».
 */
export async function closeExpiredPackages(now: Date = new Date()) {
  // Берём начало текущего дня (UTC) — пакет с expiresAt = вчера должен закрыться.
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  const result = await db.subscription.updateMany({
    where: {
      type: "package",
      status: { in: ["active", "pending"] },
      expiresAt: { lt: today },
      deletedAt: null,
    },
    data: {
      status: "closed",
      endDate: today,
    },
  })

  return { closed: result.count }
}
