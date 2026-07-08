import { db } from "@/lib/db"
import { NON_CONSUMING_CODES } from "@/lib/subscriptions/consumed-lessons"
import { deactivateGroupEnrollmentOnWithdrawal } from "@/lib/subscriptions/deactivate-enrollment"

/**
 * Авто-закрытие отработанных календарных абонементов.
 *
 * Запускается ежедневно в 03:00 МСК (см.
 * /api/cron/close-finished-calendar-subscriptions). Закрывает абонементы за
 * прошедшие месяцы, у которых:
 *   1. type='calendar'
 *   2. status='active' (pending не трогаем — там по определению долг)
 *   3. periodYear+periodMonth < текущего периода
 *   4. balance <= 0 (нет долга — иначе администратор должен разобраться)
 *   5. количество посещений с attendanceType.chargesSubscription=true и
 *      chargePercent=100 >= totalLessons
 *
 * Отменённые занятия (Lesson.status='cancelled') в текущей системе НЕ
 * декрементят Subscription.totalLessons, поэтому абонементы с отменёнными
 * праздничными днями не закроются автоматически — администратор закроет
 * вручную через кнопку «Закрыть». Это сознательное решение (вариант A),
 * чтобы не плодить ложные срабатывания.
 *
 * При закрытии:
 *   - status='closed', endDate = последний день периода абонемента.
 *   - GroupEnrollment: если у ребёнка не осталось другого живого
 *     (pending/active) абонемента в этой группе — зачисление деактивируется
 *     (deactivateGroupEnrollmentOnWithdrawal): не продлённый ребёнок не висит
 *     в будущем расписании. Продолжающего (следующий месяц уже выписан) guard
 *     хелпера не тронет. Поздняя выписка ПОСЛЕ закрытия тоже работает: её
 *     источники включают закрытые за прошлый месяц (bulk-renew.ts), а создание
 *     абонемента реактивирует зачисление (ensure-enrollment.ts).
 *   - Балансы и шаблонные скидки НЕ пересчитываем — балaнс уже 0, скидки
 *     за 2 ребёнка/направление чувствительны к статусу абонемента и могут
 *     поломаться (см. /api/cron/check-inactive-clients).
 *
 * Лог: console.info по каждому закрытому абонементу для server-side audit.
 */
export async function closeFinishedCalendarSubscriptions(now: Date = new Date()) {
  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() + 1 // 1..12

  // Кандидаты — все активные календарные абонементы за прошедшие периоды без долга.
  const candidates = await db.subscription.findMany({
    where: {
      type: "calendar",
      status: "active",
      deletedAt: null,
      balance: { lte: 0 },
      // Запланированное отчисление финализирует отдельный cron
      // (finalize-scheduled-withdrawals) — с причиной и переводом клиента в
      // «Выбывшие». Не перехватываем его здесь (иначе абонемент станет closed
      // вместо withdrawn, без причины/churn).
      scheduledWithdrawalDate: null,
      // periodYear < currentYear OR (periodYear = currentYear AND periodMonth < currentMonth)
      OR: [
        { periodYear: { lt: currentYear } },
        { periodYear: currentYear, periodMonth: { lt: currentMonth } },
      ],
    },
    select: {
      id: true,
      tenantId: true,
      clientId: true,
      wardId: true,
      groupId: true,
      periodYear: true,
      periodMonth: true,
      totalLessons: true,
    },
  })

  if (candidates.length === 0) {
    return { closed: 0, skipped: 0, enrollmentsDeactivated: 0 }
  }

  // По каждому считаем израсходованные занятия через groupBy: посещения со
  // 100%-списанием ПЛЮС финальные несписывающие отметки (Уваж. пропуск,
  // Перерасчёт) — они расходуют занятие без оплаты, и месяц с ними должен
  // закрываться так же, как полностью отхоженный. Один большой запрос вместо
  // N маленьких — затраты на cron'е минимальные даже на тысячах абонементов.
  const counts = await db.attendance.groupBy({
    by: ["subscriptionId"],
    where: {
      subscriptionId: { in: candidates.map((c) => c.id) },
      isPending: false,
      attendanceType: {
        OR: [
          { chargesSubscription: true, chargePercent: 100 },
          { chargesSubscription: false, code: { notIn: NON_CONSUMING_CODES } },
        ],
      },
    },
    _count: { _all: true },
  })
  const countBySub = new Map<string, number>()
  for (const row of counts) {
    if (row.subscriptionId) countBySub.set(row.subscriptionId, row._count._all)
  }

  const toClose = candidates.filter((c) => {
    const cnt = countBySub.get(c.id) ?? 0
    return cnt >= c.totalLessons
  })

  if (toClose.length === 0) {
    return { closed: 0, skipped: candidates.length, enrollmentsDeactivated: 0 }
  }

  // Группируем по (year, month), чтобы за один updateMany закрыть все
  // абонементы одного периода с правильным endDate.
  type PeriodKey = string // "YYYY-MM"
  const byPeriod = new Map<PeriodKey, { year: number; month: number; ids: string[] }>()
  for (const s of toClose) {
    if (s.periodYear == null || s.periodMonth == null) continue
    const key: PeriodKey = `${s.periodYear}-${s.periodMonth}`
    const bucket = byPeriod.get(key) ?? { year: s.periodYear, month: s.periodMonth, ids: [] }
    bucket.ids.push(s.id)
    byPeriod.set(key, bucket)
  }

  let closedCount = 0
  for (const { year, month, ids } of byPeriod.values()) {
    // Последний день месяца в UTC: day=0 следующего месяца.
    const endDate = new Date(Date.UTC(year, month, 0))
    const res = await db.subscription.updateMany({
      where: { id: { in: ids } },
      data: { status: "closed", endDate },
    })
    closedCount += res.count

    for (const id of ids) {
      const sub = toClose.find((c) => c.id === id)
      console.info(
        `[cron:close-finished-calendar] closed subscription ${id}`,
        {
          tenantId: sub?.tenantId,
          clientId: sub?.clientId,
          wardId: sub?.wardId,
          period: `${month}/${year}`,
          totalLessons: sub?.totalLessons,
          endDate: endDate.toISOString().slice(0, 10),
        },
      )
    }
  }

  // Не продлённый ребёнок не должен висеть в будущем расписании: деактивируем
  // зачисление, если живых (pending/active) абонементов в группе не осталось —
  // guard внутри хелпера. Каждый — в своей мини-транзакции (деактивация +
  // чистка висящих пустых отметок атомарны). Только реально закрытые
  // (byPeriod пропускает строки без periodYear/periodMonth).
  //
  // Граница состава — КОНЕЦ ПЕРИОДА + 1 (1-е число следующего месяца), а не
  // «последнее платное занятие + 1» (semantics отчисления): месяц штатно
  // отработан, ребёнок легитимно был в составе до конца периода. Иначе
  // финальные «Уваж. пропуск»/«Перерасчёт» (расходуют занятие без списания —
  // именно они делают месяц закрываемым) удалялись бы чисткой хвоста, а у
  // абонемента со 100% скидкой (ни одной платной отметки) withdrawnAt падал
  // бы в enrolledAt — ребёнок исчезал бы из состава ВСЕХ прошлых занятий.
  let enrollmentsDeactivated = 0
  for (const sub of toClose) {
    if (sub.periodYear == null || sub.periodMonth == null) continue
    // periodMonth 1-based: monthIndex = periodMonth указывает на следующий
    // месяц, день 1 = endDate периода + 1 день.
    const periodEndNext = new Date(Date.UTC(sub.periodYear, sub.periodMonth, 1))
    const n = await db.$transaction((tx) =>
      deactivateGroupEnrollmentOnWithdrawal(tx, {
        tenantId: sub.tenantId,
        groupId: sub.groupId,
        clientId: sub.clientId,
        wardId: sub.wardId,
        excludeSubscriptionId: sub.id,
        scheduledBoundary: periodEndNext,
      }),
    )
    if (n > 0) {
      enrollmentsDeactivated += n
      console.info(
        `[cron:close-finished-calendar] deactivated enrollment (no live subscription left) for subscription ${sub.id}`,
        { tenantId: sub.tenantId, clientId: sub.clientId, wardId: sub.wardId, groupId: sub.groupId },
      )
    }
  }

  return { closed: closedCount, skipped: candidates.length - closedCount, enrollmentsDeactivated }
}
