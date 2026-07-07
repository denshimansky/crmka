/**
 * Unit-тесты для deactivateGroupEnrollmentOnWithdrawal.
 *
 * Чистая логика без БД: подменяем Tx моком и проверяем:
 *  - правило «убирать ребёнка из группы только если не осталось другого живого
 *    (pending/active) абонемента в той же группе» + корректный scope по wardId;
 *  - граница состава (withdrawnAt) = последнее платное занятие в группе + 1, а
 *    при отсутствии платных занятий = enrolledAt (баг #40: отчисленный без
 *    платных занятий не должен висеть в «Неотмеченных»).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  deactivateGroupEnrollmentOnWithdrawal,
  cleanPostWithdrawalEmptyAttendance,
} from "../lib/subscriptions/deactivate-enrollment"

type AnyArgs = { where: Record<string, any>; data?: Record<string, any>; orderBy?: any; select?: any }

function makeTx(opts: {
  otherLive: number
  enrollments?: { id: string; enrolledAt: Date }[]
  lastPaidDate?: Date | null
}) {
  const calls = {
    count: [] as AnyArgs[],
    findMany: [] as AnyArgs[],
    attendanceFindFirst: [] as AnyArgs[],
    attendanceFindMany: [] as AnyArgs[],
    attendanceDeleteMany: [] as AnyArgs[],
    update: [] as AnyArgs[],
  }
  const enrollments = opts.enrollments ?? [
    { id: "e1", enrolledAt: new Date("2026-06-01T00:00:00.000Z") },
  ]
  const tx = {
    subscription: {
      count: async (args: AnyArgs) => {
        calls.count.push(args)
        return opts.otherLive
      },
      // repriceSubscription внутри чистки: findFirst → null = ранний выход.
      findFirst: async (_args: AnyArgs) => null,
    },
    attendance: {
      findFirst: async (args: AnyArgs) => {
        calls.attendanceFindFirst.push(args)
        return opts.lastPaidDate
          ? { lesson: { date: opts.lastPaidDate } }
          : null
      },
      // Чистка теперь двухфазная: findMany (денежно-безопасный фильтр) →
      // deleteMany по id. Возвращаем одну строку без абонемента, чтобы
      // deleteMany вызвался, а reprice — нет.
      findMany: async (args: AnyArgs) => {
        calls.attendanceFindMany.push(args)
        return [{ id: "a1", subscriptionId: null }]
      },
      deleteMany: async (args: AnyArgs) => {
        calls.attendanceDeleteMany.push(args)
        return { count: 0 }
      },
    },
    groupEnrollment: {
      findMany: async (args: AnyArgs) => {
        calls.findMany.push(args)
        return enrollments
      },
      update: async (args: AnyArgs) => {
        calls.update.push(args)
        return { id: (args.where as any).id }
      },
    },
  }
  return { tx, calls }
}

const base = {
  tenantId: "t",
  groupId: "g",
  clientId: "c",
  wardId: "w" as string | null,
  excludeSubscriptionId: "s1",
}

describe("deactivateGroupEnrollmentOnWithdrawal", () => {
  it("оставляет ребёнка в группе, если есть другой живой абонемент", async () => {
    const { tx, calls } = makeTx({ otherLive: 1 })
    const res = await deactivateGroupEnrollmentOnWithdrawal(tx as any, base)
    assert.equal(res, 0)
    assert.equal(calls.update.length, 0, "update не должен вызываться")
    assert.equal(calls.findMany.length, 0, "findMany не должен вызываться")
    assert.equal(
      calls.attendanceDeleteMany.length,
      0,
      "чистка отметок не должна вызываться, пока ребёнок остаётся в группе",
    )
    // guard считает только живые и исключает текущий абонемент
    assert.deepEqual(calls.count[0].where.status, { in: ["pending", "active"] })
    assert.deepEqual(calls.count[0].where.id, { not: "s1" })
    assert.equal(calls.count[0].where.deletedAt, null)
  })

  it("граница = последнее платное занятие + 1", async () => {
    const { tx, calls } = makeTx({
      otherLive: 0,
      enrollments: [{ id: "e1", enrolledAt: new Date("2026-06-01T00:00:00.000Z") }],
      lastPaidDate: new Date("2026-06-13T00:00:00.000Z"),
    })
    const res = await deactivateGroupEnrollmentOnWithdrawal(tx as any, base)
    assert.equal(res, 1)
    assert.equal(calls.update.length, 1)
    const { where, data } = calls.update[0]
    assert.equal(where.id, "e1")
    assert.equal(data!.isActive, false)
    assert.equal(
      (data!.withdrawnAt as Date).getTime(),
      new Date("2026-06-14T00:00:00.000Z").getTime(),
      "withdrawnAt = последнее платное + 1",
    )
    // Bug 2: чистка висящих отметок вызвана с cutoff = withdrawnAt (14.06), тем же
    // групповым/детским scope и денежно-безопасным фильтром. Фильтр живёт в
    // findMany (первая фаза), deleteMany удаляет по собранным id.
    assert.equal(calls.attendanceFindMany.length, 1, "должна вызываться чистка отметок")
    assert.equal(calls.attendanceDeleteMany.length, 1, "deleteMany по найденным id")
    const cw = calls.attendanceFindMany[0].where
    assert.equal(
      (cw.lesson.date.gte as Date).getTime(),
      new Date("2026-06-14T00:00:00.000Z").getTime(),
      "cutoff чистки = withdrawnAt",
    )
    assert.equal(cw.lesson.groupId, "g")
    assert.equal(cw.clientId, "c")
    assert.equal(cw.wardId, "w")
    assert.equal(cw.chargeAmount, 0)
    assert.equal(cw.instructorPayAmount, 0)
    assert.equal(cw.isMakeup, false)
    assert.equal(cw.isTrial, false)
    assert.equal(cw.isPending, false)
    assert.equal(cw.scheduledMakeupLessonId, null)
    assert.deepEqual(cw.attendanceType, { chargesSubscription: false, paysInstructor: false })
    assert.deepEqual(cw.lesson.status, { not: "cancelled" })
  })

  it("нет платных занятий → withdrawnAt = enrolledAt (невидим везде)", async () => {
    const enrolledAt = new Date("2026-06-10T00:00:00.000Z")
    const { tx, calls } = makeTx({
      otherLive: 0,
      enrollments: [{ id: "e1", enrolledAt }],
      lastPaidDate: null,
    })
    await deactivateGroupEnrollmentOnWithdrawal(tx as any, base)
    assert.equal(
      (calls.update[0].data!.withdrawnAt as Date).getTime(),
      enrolledAt.getTime(),
      "без платных занятий граница = enrolledAt",
    )
  })

  it("взрослый абонемент (wardId=null): scope по wardId IS NULL — в guard, findMany и attendance", async () => {
    const { tx, calls } = makeTx({ otherLive: 0, lastPaidDate: null })
    await deactivateGroupEnrollmentOnWithdrawal(tx as any, { ...base, wardId: null })
    // null (а не undefined) — иначе Prisma сняла бы фильтр и задела детей клиента
    assert.equal(calls.count[0].where.wardId, null)
    assert.equal(calls.findMany[0].where.wardId, null)
    assert.equal(calls.attendanceFindFirst[0].where.wardId, null)
    assert.equal(calls.count[0].where.clientId, "c")
  })

  it("последнее платное ищется только со списанием (charge_amount > 0) и в этой группе", async () => {
    const { tx, calls } = makeTx({ otherLive: 0, lastPaidDate: new Date("2026-06-13T00:00:00.000Z") })
    await deactivateGroupEnrollmentOnWithdrawal(tx as any, base)
    const w = calls.attendanceFindFirst[0].where
    assert.deepEqual(w.chargeAmount, { gt: 0 })
    assert.deepEqual(w.lesson, { groupId: "g" })
  })

  it("отложенное отчисление: withdrawnAt = scheduledBoundary (X+1), последнее платное НЕ учитывается", async () => {
    const scheduledBoundary = new Date("2026-07-01T00:00:00.000Z") // X=30.06 → X+1
    const { tx, calls } = makeTx({
      otherLive: 0,
      enrollments: [{ id: "e1", enrolledAt: new Date("2026-06-01T00:00:00.000Z") }],
      // last paid — в прошлом (13.06); при выводе по нему ребёнок выпал бы из
      // занятий 14–30.06 сразу. Отложенное отчисление обязано это игнорировать.
      lastPaidDate: new Date("2026-06-13T00:00:00.000Z"),
    })
    const res = await deactivateGroupEnrollmentOnWithdrawal(tx as any, { ...base, scheduledBoundary })
    assert.equal(res, 1)
    assert.equal(
      (calls.update[0].data!.withdrawnAt as Date).getTime(),
      scheduledBoundary.getTime(),
      "граница = X+1, а не последнее платное + 1",
    )
    assert.equal(
      calls.attendanceFindFirst.length,
      0,
      "запрос последнего платного при явной границе не нужен",
    )
    // Отложенное отчисление тоже чистит висящие отметки по своей границе (X+1).
    assert.equal(calls.attendanceFindMany.length, 1)
    assert.equal(
      (calls.attendanceFindMany[0].where.lesson.date.gte as Date).getTime(),
      scheduledBoundary.getTime(),
    )
  })
})

describe("cleanPostWithdrawalEmptyAttendance", () => {
  function makeDeleteTx(rows?: { id: string; subscriptionId: string | null }[]) {
    const calls = {
      findMany: [] as AnyArgs[],
      deleteMany: [] as AnyArgs[],
      subFindFirst: [] as AnyArgs[],
    }
    const tx = {
      attendance: {
        findMany: async (args: AnyArgs) => {
          calls.findMany.push(args)
          return rows ?? [
            { id: "a1", subscriptionId: null },
            { id: "a2", subscriptionId: null },
          ]
        },
        deleteMany: async (args: AnyArgs) => {
          calls.deleteMany.push(args)
          return { count: (args.where as any).id.in.length }
        },
      },
      subscription: {
        // repriceSubscription: findFirst → null = ранний выход (без денег в моке).
        findFirst: async (args: AnyArgs) => {
          calls.subFindFirst.push(args)
          return null
        },
      },
    }
    return { tx, calls }
  }

  it("удаляет только финансово-пустые отметки после cutoff в этой группе", async () => {
    const { tx, calls } = makeDeleteTx()
    const cutoff = new Date("2026-06-19T00:00:00.000Z")
    const n = await cleanPostWithdrawalEmptyAttendance(tx as any, {
      tenantId: "t",
      groupId: "g",
      clientId: "c",
      wardId: "w",
      cutoff,
    })
    assert.equal(n, 2)
    assert.equal(calls.findMany.length, 1)
    const w = calls.findMany[0].where
    // Денежно-безопасный фильтр: не тронет платные/ЗП/отработки/пробные/заглушки.
    assert.equal(w.chargeAmount, 0)
    assert.equal(w.instructorPayAmount, 0)
    assert.equal(w.isPending, false)
    assert.equal(w.isMakeup, false)
    assert.equal(w.isTrial, false)
    assert.equal(w.scheduledMakeupLessonId, null)
    assert.deepEqual(w.attendanceType, { chargesSubscription: false, paysInstructor: false })
    // Scope: та же группа/клиент/подопечный, занятия с cutoff включительно, без отменённых.
    assert.equal(w.lesson.groupId, "g")
    assert.equal((w.lesson.date.gte as Date).getTime(), cutoff.getTime())
    assert.deepEqual(w.lesson.status, { not: "cancelled" })
    assert.equal(w.clientId, "c")
    assert.equal(w.wardId, "w")
    assert.equal(w.tenantId, "t")
    // Удаление — строго по найденным id.
    assert.deepEqual(calls.deleteMany[0].where, { id: { in: ["a1", "a2"] } })
  })

  it("взрослый абонемент: wardId=null сохраняется (не снимает фильтр)", async () => {
    const { tx, calls } = makeDeleteTx()
    await cleanPostWithdrawalEmptyAttendance(tx as any, {
      tenantId: "t",
      groupId: "g",
      clientId: "c",
      wardId: null,
      cutoff: new Date("2026-06-19T00:00:00.000Z"),
    })
    assert.equal(calls.findMany[0].where.wardId, null)
  })

  it("нет подходящих отметок → deleteMany не вызывается", async () => {
    const { tx, calls } = makeDeleteTx([])
    const n = await cleanPostWithdrawalEmptyAttendance(tx as any, {
      tenantId: "t",
      groupId: "g",
      clientId: "c",
      wardId: "w",
      cutoff: new Date("2026-06-19T00:00:00.000Z"),
    })
    assert.equal(n, 0)
    assert.equal(calls.deleteMany.length, 0)
  })

  it("удалённые отметки с абонементом → пересчёт затронутых абонементов (уваж. пропуск расходовал слот)", async () => {
    const { tx, calls } = makeDeleteTx([
      { id: "a1", subscriptionId: "s1" },
      { id: "a2", subscriptionId: "s1" },
      { id: "a3", subscriptionId: null },
    ])
    await cleanPostWithdrawalEmptyAttendance(tx as any, {
      tenantId: "t",
      groupId: "g",
      clientId: "c",
      wardId: "w",
      cutoff: new Date("2026-06-19T00:00:00.000Z"),
    })
    // repriceSubscription вызван один раз для s1 (dedupe), null пропущен.
    assert.equal(calls.subFindFirst.length, 1)
    assert.equal(calls.subFindFirst[0].where.id, "s1")
  })
})
