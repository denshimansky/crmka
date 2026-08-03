import { db } from "@/lib/db"
import { consumedTypeWhereFor } from "@/lib/subscriptions/consumed-lessons"
import { closeSubscription } from "@/lib/subscriptions/close-subscription"

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
 *   5. число израсходованных занятий >= totalLessons. «Израсходовано» =
 *      каноничная семантика consumed-slot (consumedTypeWhereFor): любая
 *      СПИСЫВАЮЩАЯ отметка (в т.ч. частичная, как «Болезнь 50%»!) + финальные
 *      несписывающие «Уваж. пропуск»/«Перерасчёт». Раньше здесь был хардкод
 *      chargePercent=100 → календарный с частичным списанием никогда не набирал
 *      порог и не закрывался (а ручного «Закрыть» в UI больше нет → админ мог
 *      только отчислить, но отчисленный не попадает в источники массовой
 *      выписки). Теперь считаем так же, как reprice (countAttendedLessons).
 *
 * Отменённые занятия (Lesson.status='cancelled') в текущей системе НЕ
 * декрементят Subscription.totalLessons, поэтому абонементы с отменёнными
 * праздничными днями не закроются автоматически — администратор закроет
 * вручную через кнопку «Закрыть». Это сознательное решение (вариант A),
 * чтобы не плодить ложные срабатывания.
 *
 * Закрытие каждого абонемента идёт через общий хелпер closeSubscription (тот же,
 * что и ручной PATCH status=closed):
 *   - денежная сверка (net-оплачено − списано − прошлые возвраты): переплата за
 *     прощённые занятия (Уваж. пропуск/Перерасчёт) возвращается на баланс
 *     родителя, даже если reprice при отметке этого не сделал (отметки до
 *     код-фикса 07.07.2026, legacy, импорт). Раньше крон делал bare updateMany
 *     без сверки и молча «съедал» переплату — баг карточки Лескиной;
 *   - строка в историю клиента о закрытии и денежном итоге;
 *   - status='closed', endDate = последний день периода абонемента;
 *   - GroupEnrollment: если у ребёнка не осталось другого живого (pending/active)
 *     абонемента в этой группе — зачисление деактивируется. Продолжающего
 *     (следующий месяц уже выписан) guard хелпера не тронет. Поздняя выписка
 *     ПОСЛЕ закрытия тоже работает: источники включают закрытые за прошлый месяц
 *     (bulk-renew.ts), создание абонемента реактивирует зачисление.
 *   - Шаблонные скидки отдельно НЕ пересчитываем — они чувствительны к статусу
 *     абонемента и могут поломаться (см. /api/cron/check-inactive-clients).
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

  // По каждому считаем израсходованные занятия через groupBy по каноничной
  // семантике consumed-slot (та же, что в reprice/countAttendedLessons): любая
  // СПИСЫВАЮЩАЯ отметка — включая частичную (chargePercent<100, «Болезнь 50%») —
  // ПЛЮС финальные несписывающие «Уваж. пропуск»/«Перерасчёт». Один большой
  // запрос вместо N маленьких — затраты на cron'е минимальные даже на тысячах.
  const counts = await db.attendance.groupBy({
    by: ["subscriptionId"],
    where: {
      subscriptionId: { in: candidates.map((c) => c.id) },
      isPending: false,
      attendanceType: consumedTypeWhereFor("calendar"),
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

  // Закрываем каждый абонемент через общий хелпер closeSubscription: денежная
  // сверка (возврат переплаты за прощённые занятия) + строка в историю клиента +
  // status/endDate + деактивация зачисления. Каждый — в своей мини-транзакции
  // (сверка + запись истории + чистка висящих отметок атомарны). endDate хелпер
  // считает сам из периода (группировки по периодам для updateMany больше нет —
  // сверка требует пер-абонементной обработки, а закрытие раз в месяц на
  // абонемент дёшево даже на тысячах). Строки без periodYear/periodMonth
  // фильтруем: у календарного они заполнены (см. toClose).
  let closedCount = 0
  let enrollmentsDeactivated = 0
  // Валюта организации для символа в комментариях проводок — по тенанту, с кэшем
  // (крон обходит абонементы разных организаций).
  const currencyByTenant = new Map<string, string>()
  for (const sub of toClose) {
    if (sub.periodYear == null || sub.periodMonth == null) continue
    let currency = currencyByTenant.get(sub.tenantId)
    if (currency === undefined) {
      currency =
        (
          await db.organization.findUnique({
            where: { id: sub.tenantId },
            select: { currency: true },
          })
        )?.currency ?? "RUB"
      currencyByTenant.set(sub.tenantId, currency)
    }
    const res = await db.$transaction((tx) =>
      closeSubscription(tx, { tenantId: sub.tenantId, subscriptionId: sub.id, currency }),
    )
    if (!res.closed) continue
    closedCount++
    enrollmentsDeactivated += res.enrollmentsDeactivated
    console.info(
      `[cron:close-finished-calendar] closed subscription ${sub.id}`,
      {
        tenantId: sub.tenantId,
        clientId: sub.clientId,
        wardId: sub.wardId,
        period: `${sub.periodMonth}/${sub.periodYear}`,
        totalLessons: sub.totalLessons,
        balanceDelta: res.balanceDelta,
        enrollmentsDeactivated: res.enrollmentsDeactivated,
      },
    )
  }

  return { closed: closedCount, skipped: candidates.length - closedCount, enrollmentsDeactivated }
}
