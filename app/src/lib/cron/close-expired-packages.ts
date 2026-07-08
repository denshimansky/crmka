import { db } from "@/lib/db"
import { recalcClientDiscounts } from "@/lib/discounts/recalc-client-discounts"
import { deactivateGroupEnrollmentOnWithdrawal } from "@/lib/subscriptions/deactivate-enrollment"
import { nextDayUtc } from "@/lib/subscriptions/last-paid-lesson-date"

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
    select: { id: true, clientId: true, tenantId: true, groupId: true, wardId: true, expiresAt: true },
  })
  if (candidates.length === 0) return { closed: 0 }

  await db.subscription.updateMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    data: { status: "closed", endDate: today },
  })

  // Ребёнок с истёкшим пакетом не должен висеть в будущем расписании:
  // деактивируем зачисление, если живых (pending/active) абонементов в группе
  // не осталось — guard внутри хелпера. Граница состава — expiresAt + 1
  // (пакет действовал по expiresAt включительно), а НЕ «последнее платное
  // занятие + 1»: иначе хвостовые «Не был»/«Уваж.» действовавшего пакета
  // удалялись бы чисткой, а пакет без единого платного визита стирал бы
  // ребёнка из всех прошлых составов (withdrawnAt=enrolledAt). Ручное
  // продление пакета (expiresAt, closed→active) симметрично реактивирует
  // зачисление (PATCH /subscriptions/[id]).
  for (const c of candidates) {
    await db.$transaction((tx) =>
      deactivateGroupEnrollmentOnWithdrawal(tx, {
        tenantId: c.tenantId,
        groupId: c.groupId,
        clientId: c.clientId,
        wardId: c.wardId,
        excludeSubscriptionId: c.id,
        scheduledBoundary: nextDayUtc(c.expiresAt ?? today),
      }),
    )
  }

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
