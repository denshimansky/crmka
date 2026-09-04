import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  rosterWhereOnDate,
  effectiveRosterDate,
  coverageSubscriptionsWhere,
  coverageKeysOnDate,
  coverageKey,
  trialKeysForLesson,
} from "@/lib/subscriptions/roster-filter"
import { isPeriodLocked } from "@/lib/period-check"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { revertOneOffChargeForAttendance } from "@/lib/balance/revert-one-off-charge"
import { calcRefund } from "@/lib/balance/calc-refund"
import { resolveRate, resolveTrialPayMode } from "@/lib/salary/resolve-rate"
import { calcPay } from "@/lib/salary/calc-pay"
import { reallocateLessonPay } from "@/lib/salary/reallocate-lesson-pay"
import { createMissedMakeupTask } from "@/lib/tasks/missed-makeup"
import { effectiveLessonPrice, oneOffPriceWithDiscount } from "@/lib/discounts/effective-price"
import { repriceSubscription } from "@/lib/discounts/recalc-client-discounts"
import { isConsumingAttendanceType, consumedTypeWhereFor } from "@/lib/subscriptions/consumed-lessons"
import { consumedPackageLessonsMap, pickChargeableSubscription } from "@/lib/subscriptions/package-remaining"
import {
  isBlockedByPackageSelection,
  loadPackageSelections,
  packageSelectionGate,
} from "@/lib/subscriptions/subscription-lessons"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { logAudit } from "@/lib/audit"
import { recordClientStatusChange } from "@/lib/clients/status-history"
import {
  branchScopeFromSession,
  canAccessBranch,
  canAccessLessonAsInstructor,
} from "@/lib/branch-scope"

const markSchema = z.object({
  clientId: z.string().uuid("Некорректный ID клиента"),
  wardId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  subscriptionId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  attendanceTypeId: z.string().uuid("Некорректный тип посещения"),
  instructorPayEnabled: z.boolean().default(true),
  // Для типа makeup_scheduled — обязательно указать целевое занятие, на котором
  // ребёнок будет отрабатывать пропущенное.
  scheduledMakeupLessonId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
})

const bulkSchema = z.object({
  attendanceTypeId: z.string().uuid("Некорректный тип посещения"),
})

// Замок «отработанного» абонемента (решение владельца 14.08.2026). Отчисленный
// (withdrawn) или закрытый (closed) абонемент полностью отработан, и деньги по
// нему уже сведены при закрытии/отчислении (долг/возврат разнесены). Правка или
// удаление его отметок финансы заново НЕ пересчитывает → рассинхрон: двойное
// списание, фантомный долг (кейс Валеевой, Class: отметку удалили на отчисленном
// абонементе — долг не вернулся, потом занятие переотметили под новым и списали
// повторно). Поэтому отметки в таком абонементе заблокированы для ВСЕХ ролей
// (ошибку сделал владелец — role-based замок не спас бы): исправлять нужно сам
// абонемент (восстановить/выписать новый), а не отметку.
async function lockedSubWord(
  tenantId: string,
  subscriptionIds: (string | null | undefined)[],
): Promise<"отчислён" | "закрыт" | null> {
  const ids = [...new Set(subscriptionIds.filter((v): v is string => !!v))]
  if (ids.length === 0) return null
  const sub = await db.subscription.findFirst({
    where: { tenantId, id: { in: ids }, status: { in: ["withdrawn", "closed"] } },
    select: { status: true },
    orderBy: { status: "asc" }, // детерминированно при совпадении: closed < withdrawn
  })
  if (!sub) return null
  return sub.status === "withdrawn" ? "отчислён" : "закрыт"
}

function lockedMarkResponse(word: "отчислён" | "закрыт") {
  return NextResponse.json(
    {
      error:
        `Абонемент ${word} — он полностью отработан, отметки в нём заблокированы. ` +
        `Изменять или удалять их нельзя: иначе разъедутся деньги (двойное списание или ` +
        `фантомный долг). Чтобы исправить, работайте с самим абонементом — восстановите ` +
        `его или выпишите новый.`,
    },
    { status: 409 },
  )
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = (session.user as any).tenantId
  const employeeId = (session.user as any).employeeId

  const body = await req.json()
  const parsed = markSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Verify lesson exists and belongs to tenant
  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    include: {
      group: {
        include: { direction: true },
      },
    },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  // ADM-04: инструктор — только свои занятия (включая substitute); admin/manager
  // с ограниченным scope — только в своих филиалах.
  const role = (session.user as any).role
  // Роль «только чтение» не отмечает (UI это уже скрывает; защищаем API).
  if (role === "readonly") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }
  const allowedBranchIds = (session.user as any).allowedBranchIds as string[] | null | undefined
  const scope = branchScopeFromSession(allowedBranchIds)
  if (role === "instructor") {
    if (!canAccessLessonAsInstructor(lesson, employeeId)) {
      return NextResponse.json({ error: "Нет доступа к этому занятию" }, { status: 403 })
    }
  } else if (!canAccessBranch(lesson.group.branchId, scope)) {
    return NextResponse.json({ error: "Нет доступа к филиалу этого занятия" }, { status: 403 })
  }

  // Проверка закрытия периода
  if (await isPeriodLocked(tenantId, new Date(lesson.date), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  // Get attendance type
  const attendanceType = await db.attendanceType.findFirst({
    where: {
      id: data.attendanceTypeId,
      OR: [{ tenantId: null }, { tenantId }],
      isActive: true,
    },
  })
  if (!attendanceType) return NextResponse.json({ error: "Тип посещения не найден" }, { status: 404 })

  // Пер-организационный оверрайд системного типа (баг #82): отключение + доступ роли.
  const typeOverride = await db.attendanceTypeWithdrawalOverride.findUnique({
    where: { tenantId_attendanceTypeId: { tenantId, attendanceTypeId: attendanceType.id } },
    select: { isDisabled: true, availableToInstructor: true, availableToAdmin: true },
  })
  if (typeOverride?.isDisabled) {
    return NextResponse.json(
      { error: `Тип «${attendanceType.name}» отключён в настройках организации.` },
      { status: 400 },
    )
  }

  // Доступ роли к типу: инструктор → availableToInstructor, админ → availableToAdmin.
  // Значение — эффективное для центра (оверрайд имеет приоритет над общей строкой).
  // Управляющий и владелец видят/ставят всё.
  const effAvailableToInstructor = typeOverride?.availableToInstructor ?? attendanceType.availableToInstructor
  const effAvailableToAdmin = typeOverride?.availableToAdmin ?? attendanceType.availableToAdmin
  if (role === "instructor" && !effAvailableToInstructor) {
    return NextResponse.json(
      { error: `Тип «${attendanceType.name}» не доступен инструктору. Обратитесь к администратору.` },
      { status: 403 }
    )
  }
  if (role === "admin" && !effAvailableToAdmin) {
    return NextResponse.json(
      { error: `Тип «${attendanceType.name}» не доступен администратору в этом центре.` },
      { status: 403 }
    )
  }

  // Валидация «Назначена отработка»: обязательное целевое занятие и проверка,
  // что ребёнок уже не отработал этот пропуск где-то ещё.
  let scheduledMakeupLessonId: string | null = data.scheduledMakeupLessonId
  if (attendanceType.code === "makeup_scheduled") {
    if (!scheduledMakeupLessonId) {
      return NextResponse.json(
        { error: "Для «Назначена отработка» нужно выбрать дату и занятие, где будет отработка" },
        { status: 400 }
      )
    }
    if (scheduledMakeupLessonId === lessonId) {
      return NextResponse.json(
        { error: "Целевое занятие отработки не может совпадать с текущим" },
        { status: 400 }
      )
    }
    const targetLesson = await db.lesson.findFirst({
      where: { id: scheduledMakeupLessonId, tenantId },
      select: { id: true },
    })
    if (!targetLesson) {
      return NextResponse.json({ error: "Целевое занятие не найдено" }, { status: 404 })
    }
    const alreadyMadeUp = await db.attendance.findFirst({
      where: {
        tenantId,
        makeupOfLessonId: lessonId,
        clientId: data.clientId,
        // chargeAmount > 0 — реальная отработка (Был), не «не пришёл».
        // Иначе админ не сможет переназначить отработку после «Не был».
        chargeAmount: { gt: 0 },
        ...(data.wardId ? { wardId: data.wardId } : {}),
      },
      select: { id: true },
    })
    if (alreadyMadeUp) {
      return NextResponse.json(
        { error: "Ребёнок уже отработал этот пропуск — назначать отработку повторно нельзя" },
        { status: 409 }
      )
    }
  } else {
    // Для всех остальных типов поле игнорируем — связь висит только на makeup_scheduled.
    scheduledMakeupLessonId = null
  }

  // Снятие/смена статуса «Назначена отработка» — только владелец.
  // Админ/менеджер не могут передумать за владельца, чтобы не было «незаметной»
  // отмены назначения и неожиданного списания.
  const existingForLockCheck =
    (data.subscriptionId
      ? await db.attendance.findUnique({
          where: { tenantId_lessonId_subscriptionId: { tenantId, lessonId, subscriptionId: data.subscriptionId } },
          include: { attendanceType: { select: { code: true } } },
        })
      : null) ??
    (await db.attendance.findFirst({
      // subscriptionId НЕ фиксируем: сетка «Посещения» шлёт null, а реальная
      // отметка (в т.ч. «Назначена отработка») может нести subscriptionId.
      // Ищем по (занятие, клиент, подопечный) — иначе роль-гейт «снять
      // Назначена отработка / Был на отработке» обходился через null-путь сетки.
      // Тот же фоллбэк нужен и когда subscriptionId ПРИШЁЛ, но не совпал с
      // абонементом уже стоящей отметки (два покрывающих абонемента, FIFO
      // переключился на второй) — иначе роль-гейт обходился переотметкой.
      where: { lessonId, tenantId, clientId: data.clientId, wardId: data.wardId },
      include: { attendanceType: { select: { code: true } } },
    }))
  if (
    existingForLockCheck &&
    (existingForLockCheck.attendanceType.code === "makeup_scheduled" ||
      existingForLockCheck.attendanceType.code === "makeup") &&
    existingForLockCheck.attendanceTypeId !== data.attendanceTypeId &&
    role !== "owner"
  ) {
    // «Отработано» (makeup) на первоначальном занятии тоже защищаем: снять
    // проведённую отработку следует на самом занятии-отработке («Не был»),
    // а не переписывать статус исходного занятия (иначе двойное списание).
    return NextResponse.json(
      { error: "Снять статус отработки может только владелец (отменить проведённую отработку — на занятии-отработке кнопкой «Не был»)" },
      { status: 403 }
    )
  }

  // Снятие отметки «Был» на отработке — только админ/управляющий/владелец.
  // Инструктор поставил отметку → за неё могла быть выплачена ЗП. Дальше
  // менять должен старший: он же отвечает за корректировку ведомостей.
  if (
    existingForLockCheck &&
    existingForLockCheck.isMakeup &&
    Number(existingForLockCheck.chargeAmount) > 0 &&
    attendanceType.code !== "present" &&
    role === "instructor"
  ) {
    return NextResponse.json(
      { error: "Снять «Был» на отработке может только админ, управляющий или владелец" },
      { status: 403 },
    )
  }

  // Ф7: Виртуальная отработка — на ЭТО занятие назначена отработка с другого
  // (более раннего) занятия. На L1 живёт Attendance с code=makeup_scheduled и
  // scheduledMakeupLessonId=текущему lessonId. Здесь, на L2, ребёнок появляется
  // как виртуальная строка. Инструктор ставит «Был» (создаём реальную отработку,
  // списываем с абонемента L1) или «Не был» (задача админу переназначить).
  const virtualMakeup = await db.attendance.findFirst({
    where: {
      tenantId,
      clientId: data.clientId,
      wardId: data.wardId,
      scheduledMakeupLessonId: lessonId,
      // makeup_scheduled — отработка ещё не проведена; makeup — уже проведена
      // (первоначальное занятие переведено в «Отработано»), но связь через
      // scheduledMakeupLessonId сохранена, чтобы «Не был» на L2 корректно
      // откатывал обе стороны.
      attendanceType: { code: { in: ["makeup_scheduled", "makeup"] } },
    },
    include: {
      lesson: {
        select: {
          id: true,
          date: true,
          group: { select: { direction: { select: { name: true } } } },
        },
      },
      client: { select: { firstName: true, lastName: true } },
      attendanceType: { select: { code: true } },
    },
  })
  // Ward не имеет relation в Attendance — подгружаем отдельно, если нужно.
  const virtualMakeupWard = virtualMakeup?.wardId
    ? await db.ward.findUnique({
        where: { id: virtualMakeup.wardId },
        select: { firstName: true, lastName: true },
      })
    : null
  const isMakeupArrival = !!virtualMakeup
  const sourceMakeupLessonId = virtualMakeup?.lesson.id ?? null

  if (isMakeupArrival) {
    if (attendanceType.code !== "present" && attendanceType.code !== "no_show") {
      return NextResponse.json(
        { error: "На отработке доступны только «Был» или «Не был»" },
        { status: 400 },
      )
    }
    // Переключаем subscriptionId на исходное (L1) — списания/откаты пойдут
    // с абонемента группы пропущенного занятия, а не текущей.
    data.subscriptionId = virtualMakeup.subscriptionId
  }

  // Замок отработанного абонемента: если ученик на этом занятии уже отмечен по
  // отчисленному/закрытому абонементу (или его явно передали) — менять состав
  // отметок нельзя. Проверяем и переданный subscriptionId, и все уже стоящие
  // отметки ученика на занятии (по любому абонементу) — иначе блок обходился бы
  // через сетку (subscriptionId=null) или переотметку под новым абонементом.
  // Отработки (isMakeupArrival) не трогаем: у них своя логика списания со слота L1.
  if (!isMakeupArrival) {
    const priorSubIds = (
      await db.attendance.findMany({
        where: {
          tenantId,
          lessonId,
          clientId: data.clientId,
          wardId: data.wardId,
          subscriptionId: { not: null },
        },
        select: { subscriptionId: true },
      })
    ).map((m) => m.subscriptionId)
    const word = await lockedSubWord(tenantId, [data.subscriptionId, ...priorSubIds])
    if (word) return lockedMarkResponse(word)
  }

  // Fetch org setting for subscription type.
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { subscriptionType: true },
  })

  // Режим оплаты пробных — из ставки инструктора этого занятия (перенесено из
  // настройки организации). Резолвим один раз на занятие.
  const trialEffInstructorId = lesson.substituteInstructorId || lesson.instructorId
  const trialMode = lesson.isTrial && trialEffInstructorId
    ? await resolveTrialPayMode(db, {
        tenantId,
        groupId: lesson.groupId,
        employeeId: trialEffInstructorId,
        directionId: lesson.group.directionId,
      }, new Date(lesson.date))
    : "none"

  // Тип дня без начисления инструктору (Уваж. пропуск, Перерасчёт и т.п.) —
  // галочка «Оплата инструктору» не имеет смысла и принудительно снимается,
  // что бы ни прислал клиент (по умолчанию schema шлёт true).
  const instructorPayEnabled = attendanceType.paysInstructor
    ? data.instructorPayEnabled
    : false

  // Блокировка отметки вне плана пакета (решение владельца №1): списывающий тип на
  // НЕвыбранном занятии, когда у ученика есть живой пакет с выбором → ошибка, НЕ drop-in.
  // Отработка (списывается со слота исходного L1) и пробное исключены.
  if (
    org?.subscriptionType === "package" &&
    attendanceType.chargesSubscription &&
    !isMakeupArrival &&
    !lesson.isTrial
  ) {
    const blocked = await isBlockedByPackageSelection(db, {
      tenantId,
      clientId: data.clientId,
      wardId: data.wardId,
      groupId: lesson.groupId,
      lessonId,
      lessonDate: new Date(effectiveRosterDate(lesson)),
    })
    if (blocked) {
      return NextResponse.json(
        { error: "Занятие не входит в пакет ученика. Измените план пакета." },
        { status: 409 },
      )
    }
  }

  // === Вся бизнес-логика в транзакции ===
  const attendance = await db.$transaction(async (tx) => {
    // Ф8 (переработано 25.08.2026): «Не был» на отработке. Раньше удаляли обе
    // стороны — ребёнок пропадал и с занятия-отработки (L2), и из «Назначена
    // отработка» на исходном (L1). Теперь след сохраняем, ничего не удаляя:
    //  · L2 (это занятие): отметка остаётся как isMakeup + no_show, списание/ЗП
    //    откатываем в 0. В ростер она не идёт — рисуется строкой-справкой «не был
    //    на отработке» в сводке «По типам» и тянется в историю посещений клиента.
    //  · L1 (исходное): makeup_scheduled/makeup → no_show, снимаем ссылку
    //    scheduled_makeup_lesson_id — админ на L1 переназначит отработку или
    //    закроет другим статусом. Бейдж «не был на отработке DD.MM» на L1
    //    вычисляется из этой же L2-записи (makeup_of_lesson_id).
    // Финансово безопасно: обе makeup-стороны не списывают и не платят ЗП по типу;
    // единственные деньги к откату — прежний «Был» на L2 (слот абонемента L1 + ЗП).
    if (isMakeupArrival && attendanceType.code === "no_show") {
      // Прежняя отметка на L2 (если раньше стоял «Был»): по (занятие, абонемент),
      // а при пропуске без покрывающего абонемента — по (занятие, клиент, ward).
      const existingOnL2 = data.subscriptionId
        ? await tx.attendance.findUnique({
            where: { tenantId_lessonId_subscriptionId: { tenantId, lessonId, subscriptionId: data.subscriptionId } },
            include: { attendanceType: { select: { chargePercent: true } } },
          })
        : await tx.attendance.findFirst({
            where: { tenantId, lessonId, clientId: data.clientId, wardId: data.wardId, isMakeup: true },
            include: { attendanceType: { select: { chargePercent: true } } },
          })

      // Откат списания слота абонемента L1 и недосписанной части (был «Был»).
      if (existingOnL2 && Number(existingOnL2.chargeAmount) > 0) {
        const prevRefund = calcRefund(existingOnL2.chargeAmount, existingOnL2.attendanceType.chargePercent)
        if (prevRefund.gt(0)) {
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: data.clientId,
            delta: prevRefund.negated(),
            type: "attendance_revert",
            refs: { lessonId, attendanceId: existingOnL2.id, directionId: lesson.group.directionId },
            createdBy: employeeId,
          })
        }
        if (existingOnL2.subscriptionId) {
          await tx.subscription.update({
            where: { id: existingOnL2.subscriptionId },
            data: { chargedAmount: { decrement: existingOnL2.chargeAmount } },
          })
        }
      }

      // L2: конвертируем/создаём отметку «Не был на отработке» (isMakeup, без
      // списания и ЗП). makeup_of_lesson_id → исходное занятие (по нему бейдж на
      // L1 и история); scheduled_makeup_lesson_id тут не нужен (это уже L2).
      let makeupNoShow
      if (existingOnL2) {
        makeupNoShow = await tx.attendance.update({
          where: { id: existingOnL2.id },
          data: {
            attendanceTypeId: data.attendanceTypeId,
            chargeAmount: 0,
            instructorPayAmount: 0,
            instructorPayEnabled: false,
            isMakeup: true,
            makeupOfLessonId: sourceMakeupLessonId,
            scheduledMakeupLessonId: null,
            isPending: false,
            markedBy: employeeId,
            markedAt: new Date(),
          },
        })
      } else {
        makeupNoShow = await tx.attendance.create({
          data: {
            tenantId,
            lessonId,
            subscriptionId: data.subscriptionId,
            clientId: data.clientId,
            wardId: data.wardId,
            attendanceTypeId: data.attendanceTypeId,
            chargeAmount: 0,
            instructorPayAmount: 0,
            instructorPayEnabled: false,
            isMakeup: true,
            makeupOfLessonId: sourceMakeupLessonId,
            markedBy: employeeId,
            markedAt: new Date(),
          },
        })
      }

      // per_lesson/floating: если откатили оплаченный «Был» — пересчитать ЗП L2.
      await reallocateLessonPay(tx, { tenantId, lessonId })
      // Реприс абонемента L1: вернуть слот/«ожидание оплаты» после отката списания.
      if (existingOnL2?.subscriptionId) {
        await repriceSubscription(tx, {
          tenantId,
          subscriptionId: existingOnL2.subscriptionId,
          createdBy: employeeId,
        })
      }

      // L1: «Назначена отработка»/«Отработано» → «Не был», снять ссылку на L2,
      // чтобы админ мог переназначить отработку или закрыть другим статусом.
      if (virtualMakeup) {
        await tx.attendance.update({
          where: { id: virtualMakeup.id },
          data: {
            attendanceTypeId: data.attendanceTypeId,
            scheduledMakeupLessonId: null,
          },
        })
      }

      return makeupNoShow
    }

    // Calculate charge amount
    let chargeAmount = new Prisma.Decimal(0)
    let subscriptionId = data.subscriptionId

    // Баг: сетка «Посещения» шлёт subscriptionId=null (в отличие от карточки
    // занятия, которая шлёт реальный id). При смене СПИСЫВАЮЩЕЙ отметки на
    // несписывающую (Был → Не был/Уваж./Перерасчёт) резолв ниже subscriptionId не
    // восстанавливал — управление уходило в ветку «без абонемента», строка
    // present(S) не находилась (искалась по subscriptionId=null) → создавалась
    // ВТОРАЯ строка, а списание не откатывалось: отметку было не исправить.
    // Восстанавливаем subscriptionId по уже существующей отметке ученика на этом
    // занятии — тогда upsert идёт по ТОЙ ЖЕ строке и корректно откатывает старое
    // списание/переключает абонемент. orderBy chargeAmount desc — если остался
    // исторический дубль, берём заряженную строку (её и надо откатить). Пробное и
    // виртуальную отработку не трогаем: там свои ключи и отдельная семантика.
    let oneTimeChargedPrior = false
    if (!subscriptionId && !isMakeupArrival && !lesson.isTrial) {
      const priorMark = await tx.attendance.findFirst({
        where: { tenantId, lessonId, clientId: data.clientId, wardId: data.wardId },
        orderBy: { chargeAmount: "desc" },
        select: { subscriptionId: true, chargeAmount: true, isPending: true },
      })
      if (priorMark?.subscriptionId) {
        subscriptionId = priorMark.subscriptionId
      } else if (priorMark && !priorMark.isPending && Number(priorMark.chargeAmount) > 0) {
        // Заряженная РАЗОВАЯ отметка (subscriptionId=null, списание с баланса
        // родителя). Несписывающий тип не должен резолвить абонемент (даже если
        // он появился позже): иначе upsert по (lesson, subscriptionId) не найдёт
        // строку → дубль, разовое списание не откатится, а слот абонемента
        // ошибочно израсходуется. else-ветка ниже обновит строку на месте и
        // откатит personal_lesson_charge.
        oneTimeChargedPrior = true
      }
    }

    // Финальная несписывающая отметка (Уваж. пропуск/Перерасчёт) расходует
    // занятие календарного абонемента без списания — её тоже нужно привязать
    // к абонементу, чтобы repriceSubscription убрал ожидание оплаты за это
    // занятие (иначе фантомный долг «К оплате» за пропущенное занятие).
    const consumesSlot = isConsumingAttendanceType(attendanceType)

    if (attendanceType.chargesSubscription && subscriptionId) {
      const subscription = await tx.subscription.findFirst({
        where: { id: subscriptionId, tenantId, deletedAt: null, status: { in: ["active", "pending"] } },
      })
      if (subscription) {
        // Скидки v2: списание по эффективной цене (цена − скидка за занятие).
        chargeAmount = effectiveLessonPrice(subscription)
      }
    } else if (
      !subscriptionId &&
      (attendanceType.chargesSubscription ||
        (consumesSlot && !oneTimeChargedPrior))
    ) {
      // Резолв абонемента по дате состава (исходная дата при переносе): иначе
      // перенесённое на более поздний день занятие списало бы с абонемента
      // ученика, начавшего заниматься позже исходной даты (пакет по startDate,
      // календарный — по месяцу исходной даты).
      const lessonDate = new Date(effectiveRosterDate(lesson))
      let subscription
      if (org?.subscriptionType === "package") {
        // Пакетный: FIFO — самый старый активный пакет с ОСТАТКОМ ЗАНЯТИЙ > 0
        // (totalLessons − израсходовано, исключая этот урок). Критерий — остаток
        // ЗАНЯТИЙ, а НЕ balance: полностью оплаченный пакет (balance=0) с
        // невыгоревшими занятиями обязан находиться, иначе визит уходил в разовое
        // с баланса родителя. Исключаем этот урок из счёта, чтобы перезапись уже
        // проведённой отметки не обнуляла остаток самим этим уроком. Только для
        // СПИСЫВАЮЩИХ отметок: пропуск занятие пакета не сжигает.
        if (attendanceType.chargesSubscription) {
          const candidates = await tx.subscription.findMany({
            where: {
              tenantId,
              clientId: data.clientId,
              groupId: lesson.groupId,
              type: "package",
              deletedAt: null,
              status: { in: ["active", "pending"] },
              startDate: { lte: lessonDate },
              OR: [{ expiresAt: null }, { expiresAt: { gte: lessonDate } }],
              ...(data.wardId ? { wardId: data.wardId } : {}),
            },
            orderBy: { startDate: "asc" },
          })
          // Пакет с выбором списывается только на выбранном занятии; легаси (без
          // строк выбора) → gate=true (прежнее поведение). Блок вне плана уже отсеян выше.
          const fifoSel = await loadPackageSelections(tx, tenantId, candidates.map((c) => c.id))
          for (const cand of candidates) {
            if (!packageSelectionGate(fifoSel, cand.id, lessonId)) continue
            const consumed = await tx.attendance.count({
              where: {
                tenantId,
                subscriptionId: cand.id,
                lessonId: { not: lessonId },
                attendanceType: consumedTypeWhereFor("package"),
              },
            })
            if (cand.totalLessons - consumed > 0) {
              subscription = cand
              break
            }
          }
        }
      } else {
        // Календарный: поиск по месяцу занятия.
        subscription = await tx.subscription.findFirst({
          where: {
            tenantId,
            clientId: data.clientId,
            groupId: lesson.groupId,
            periodYear: lessonDate.getFullYear(),
            periodMonth: lessonDate.getMonth() + 1,
            deletedAt: null,
            status: { in: ["active", "pending"] },
            ...(data.wardId ? { wardId: data.wardId } : {}),
          },
        })
      }
      if (subscription) {
        subscriptionId = subscription.id
        if (attendanceType.chargesSubscription) {
          // Скидки v2: списание по эффективной цене (цена − скидка за занятие).
          chargeAmount = effectiveLessonPrice(subscription)
        }
      }
    }

    // Calculate instructor pay через единые утилиты resolve-rate + calc-pay
    let instructorPayAmount = new Prisma.Decimal(0)
    if (attendanceType.paysInstructor && instructorPayEnabled) {
      const rate = await resolveRate(tx, {
        tenantId,
        groupId: lesson.groupId,
        employeeId: lesson.substituteInstructorId || lesson.instructorId,
        directionId: lesson.group.directionId,
      }, new Date(lesson.date))
      if (rate) {
        instructorPayAmount = await calcPay(tx, {
          rate,
          lessonId,
          tenantId,
          currentClientId: data.clientId,
          currentChargeAmount: chargeAmount,
        })
      }
    }

    // Trial lesson instructor pay logic (trialPayMode):
    // - none      → never pay for trials
    // - paid_only → pay only if chargeAmount > 0 (paid trial)
    // - all       → pay regardless
    // Fail-closed: неизвестное значение режима = не платим.
    if (lesson.isTrial && Number(instructorPayAmount) > 0) {
      const allowPay = trialMode === "all" || (trialMode === "paid_only" && Number(chargeAmount) > 0)
      if (!allowPay) {
        instructorPayAmount = new Prisma.Decimal(0)
      }
    }

    // Upsert attendance
    let att
    if (subscriptionId) {
      let existing = await tx.attendance.findUnique({
        where: { tenantId_lessonId_subscriptionId: { tenantId, lessonId, subscriptionId } },
        include: { attendanceType: { select: { chargePercent: true } } },
      })

      // Баг #38 / дубль «Не был»: отметка того же ученика на этом занятии может
      // храниться БЕЗ subscriptionId (типичный случай — «Не был»: no_show
      // абонемент не резолвит, subscription_id=null). При смене на тип,
      // резолвящий абонемент (списывающий ИЛИ расходующий занятие — «Уваж.
      // пропуск»), ключ (lesson, subscriptionId) её не находит. Раньше её лишь
      // удаляла очистка ниже, и ТОЛЬКО финансово пустую (charge=0 И ЗП=0). Но с
      // включённой «Оплатой инструктору за прогул» no_show несёт ЗП>0 → под
      // очистку не попадал: появлялась ВТОРАЯ отметка, а старый «Не был» (с ЗП)
      // висел в реестре «Пропусков» и продолжал платить инструктору. Решение —
      // ПЕРЕИСПОЛЬЗОВАТЬ такую строку: обновляем её на месте (перецепив на
      // резолвнутый абонемент), а не плодим дубль. ЗП и списание пересчитаются
      // штатно ниже (update + reallocateLessonPay + repriceSubscription).
      if (!existing) {
        existing = await tx.attendance.findFirst({
          where: {
            tenantId,
            lessonId,
            clientId: data.clientId,
            wardId: data.wardId,
            subscriptionId: null,
          },
          // Предпочитаем реальную «нагруженную» отметку (оплаченный «Не был»)
          // плейсхолдеру: её очистка ниже не удалит, поэтому переиспользовать
          // надо именно её, иначе останется дубль.
          orderBy: [
            { instructorPayAmount: "desc" },
            { chargeAmount: "desc" },
            { isPending: "asc" },
            { markedAt: "desc" },
          ],
          include: { attendanceType: { select: { chargePercent: true } } },
        })
      }

      // Дубль при ДВУХ покрывающих абонементах (кейс Тарасовой, занятие
      // 26.08.2026): ключ отметки — (занятие, АБОНЕМЕНТ), поэтому когда резолвер
      // сменил абонемент, повторная отметка не находила прежнюю строку и
      // создавала ВТОРУЮ. Сценарий: пакет A исчерпан ретро-отметками, пакет B
      // выписан задним числом с пересечением периода → FIFO
      // (pickChargeableSubscription) на том же занятии выдаёт уже B, карточка
      // занятия шлёт B явным subscriptionId, и одно занятие списывается с ДВУХ
      // абонементов: перерасход пакета A (фантомный долг), сгоревшее занятие
      // пакета B, задвоенные ЗП инструктора и выручка.
      //
      // Инвариант: один ребёнок на одном занятии = ОДНА отметка. Переиспользуем
      // строку с другим абонементом — update ниже перецепляет её на резолвнутый
      // subscriptionId и откатывает списание прежнего (плюс repriceSubscription
      // для обоих). Замок отчислённого/закрытого абонемента отрабатывает выше
      // (priorSubIds), поэтому перецепить «запертую» отметку этот путь не даст.
      // Пробные (isTrial) и отработки — отдельные визиты со своей семантикой и
      // своими строками: их не переиспользуем.
      if (!existing) {
        existing = await tx.attendance.findFirst({
          where: {
            tenantId,
            lessonId,
            clientId: data.clientId,
            wardId: data.wardId,
            subscriptionId: { not: null },
            isTrial: false,
            isMakeup: isMakeupArrival,
          },
          // Как и выше: предпочитаем финансово «нагруженную» строку — её и надо
          // откатить, иначе списание прежнего абонемента останется висеть.
          orderBy: [
            { chargeAmount: "desc" },
            { instructorPayAmount: "desc" },
            { isPending: "asc" },
            { markedAt: "desc" },
          ],
          include: { attendanceType: { select: { chargePercent: true } } },
        })
      }

      // Абонемент, с которого отметку перецепляем (если перецепляем): его тоже
      // надо репрайсить в конце — иначе на нём останется раздутый finalAmount /
      // фантомный долг за занятие, ушедшее на другой абонемент.
      const prevSubscriptionId =
        existing?.subscriptionId && existing.subscriptionId !== subscriptionId
          ? existing.subscriptionId
          : null

      // Прочие «осиротевшие» финансово пустые строки без subscriptionId убираем
      // (кроме переиспользуемой выше по id) — иначе после смены типа остаётся
      // дубль. Только charge=0 И ЗП=0: денег такие записи не несут.
      const orphanNullSub = await tx.attendance.findMany({
        where: {
          tenantId,
          lessonId,
          clientId: data.clientId,
          wardId: data.wardId,
          subscriptionId: null,
          chargeAmount: 0,
          instructorPayAmount: 0,
          ...(existing ? { id: { not: existing.id } } : {}),
        },
        select: { id: true },
      })
      for (const o of orphanNullSub) {
        await tx.attendance.delete({ where: { id: o.id } })
      }

      // Откат предыдущего возврата (lesson_refund) при смене типа посещения.
      // Только для отметки ПО АБОНЕМЕНТУ: lesson_refund пишется исключительно в
      // этой ветке (частичное списание), а разовое уходит с баланса ПОЛНОЙ
      // суммой — у строки без subscriptionId откатывать нечего.
      if (existing && existing.subscriptionId && Number(existing.chargeAmount) > 0) {
        const prevRefund = calcRefund(existing.chargeAmount, existing.attendanceType.chargePercent)
        if (prevRefund.gt(0)) {
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: data.clientId,
            delta: prevRefund.negated(),
            type: "attendance_revert",
            refs: { lessonId, attendanceId: existing.id, directionId: lesson.group.directionId },
            createdBy: employeeId,
          })
        }
      }

      if (existing) {
        // Reverse previous charge
        if (existing.subscriptionId && Number(existing.chargeAmount) > 0) {
          await tx.subscription.update({
            where: { id: existing.subscriptionId },
            data: {
              chargedAmount: { decrement: existing.chargeAmount },
            },
          })
        } else if (!existing.subscriptionId) {
          // Отметка была РАЗОВОЙ: её стоимость ушла с баланса родителя, а не с
          // абонемента. Перецепляя строку на абонемент (выписан задним числом
          // на уже отмеченные даты), обязаны вернуть разовое списание — иначе
          // занятие оплачено дважды. Подробности и семантика — в хелпере.
          await revertOneOffChargeForAttendance(tx, {
            tenantId,
            clientId: data.clientId,
            attendanceId: existing.id,
            lessonId,
            directionId: lesson.group.directionId,
            createdBy: employeeId,
          })
        }

        att = await tx.attendance.update({
          where: { id: existing.id },
          data: {
            // Перецепляем на резолвнутый абонемент: для обычного пути значение
            // не меняется, для переиспользованной null-sub строки (см. выше) —
            // связывает отметку с абонементом, чтобы repriceSubscription учёл её.
            subscriptionId,
            attendanceTypeId: data.attendanceTypeId,
            chargeAmount,
            instructorPayAmount,
            instructorPayEnabled,
            scheduledMakeupLessonId,
            isMakeup: isMakeupArrival,
            makeupOfLessonId: sourceMakeupLessonId,
            // Реальная отметка с абонементом не бывает «в ожидании»; если
            // переиспользовали плейсхолдер (isPending=true) — снимаем флаг.
            isPending: false,
            markedBy: employeeId,
            markedAt: new Date(),
          },
        })
      } else {
        att = await tx.attendance.create({
          data: {
            tenantId,
            lessonId,
            subscriptionId,
            clientId: data.clientId,
            wardId: data.wardId,
            attendanceTypeId: data.attendanceTypeId,
            chargeAmount,
            instructorPayAmount,
            instructorPayEnabled,
            scheduledMakeupLessonId,
            isMakeup: isMakeupArrival,
            makeupOfLessonId: sourceMakeupLessonId,
            markedBy: employeeId,
            markedAt: new Date(),
          },
        })
      }

      // Debit subscription
      if (attendanceType.chargesSubscription && Number(chargeAmount) > 0) {
        await tx.subscription.update({
          where: { id: subscriptionId },
          data: {
            chargedAmount: { increment: chargeAmount },
          },
        })

        // Возврат недосписанной части на баланс клиента при chargePercent < 100
        const refund = calcRefund(chargeAmount, attendanceType.chargePercent)
        if (refund.gt(0)) {
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: data.clientId,
            delta: refund,
            type: "lesson_refund",
            refs: { lessonId, attendanceId: att.id, directionId: lesson.group.directionId, subscriptionId },
            createdBy: employeeId,
          })
        }

        // Lead→Client conversion: платное посещение делает клиента активным.
        // Условие через ИЛИ — срабатывает, пока клиент не полностью «Активный
        // клиент + active», поэтому лечит и рассинхрон (напр. Архив+active).
        // ЧС не трогаем: снять бан может только владелец вручную.
        const client = await tx.client.findUnique({ where: { id: data.clientId } })
        const notFullyActive =
          !!client && (client.funnelStatus !== "active_client" || client.clientStatus !== "active")
        if (client && notFullyActive && client.funnelStatus !== "blacklisted") {
          await tx.client.update({
            where: { id: data.clientId },
            data: {
              funnelStatus: "active_client",
              clientStatus: "active",
              // Дата первого платного занятия — этой отметкой клиент и стал
              // покупателем (используется воронкой продаж и отчётами конверсии).
              ...(client.firstPaidLessonDate ? {} : { firstPaidLessonDate: lesson.date }),
            },
          })
          await recordClientStatusChange(tx, {
            tenantId,
            clientId: data.clientId,
            employeeId,
            funnel: { old: client.funnelStatus, new: "active_client" },
            client: { old: client.clientStatus, new: "active" },
            reason: "paid_lesson",
          })
        }
      }

      // Скидки v2: смена отметки могла заменить списание по старой цене
      // списанием по новой (скидка применена/снята между отметками) —
      // выравниваем finalAmount/balance по фактическому снимку списаний.
      await repriceSubscription(tx, {
        tenantId,
        subscriptionId,
        createdBy: employeeId,
      })

      // Отметку перецепили с другого абонемента — выравниваем и его: списание
      // уже откачено выше (chargedAmount decrement), но finalAmount/balance
      // пересчитывает только reprice, без него на прежнем абонементе остаётся
      // фантомный долг за занятие, которое теперь списано с другого.
      if (prevSubscriptionId) {
        await repriceSubscription(tx, {
          tenantId,
          subscriptionId: prevSubscriptionId,
          createdBy: employeeId,
        })
      }
    } else {
      // No subscription — разовое посещение (или нет подходящего абонемента).
      // Для типов с chargesSubscription=true списываем стоимость разового
      // посещения с баланса родителя; placeholder (isPending=true) переводим
      // в реальную отметку.
      const existing = await tx.attendance.findFirst({
        where: {
          lessonId,
          clientId: data.clientId,
          wardId: data.wardId,
          subscriptionId: null,
        },
      })

      // Откат предыдущего списания с баланса (если уже была реальная отметка).
      if (existing && !existing.isPending && Number(existing.chargeAmount) > 0) {
        await applyBalanceDelta(tx, {
          tenantId,
          clientId: data.clientId,
          delta: existing.chargeAmount,
          type: "attendance_revert",
          refs: {
            lessonId,
            attendanceId: existing.id,
            directionId: lesson.group.directionId,
          },
          createdBy: employeeId,
        })
      }

      // Постоянная скидка клиента (шаблон в карточке) действует и на разовые
      const oneOffClient = await tx.client.findUnique({
        where: { id: data.clientId },
        include: { discountTemplate: true },
      })

      let newChargeAmount = new Prisma.Decimal(0)
      let oneOffBase = new Prisma.Decimal(0)
      if (attendanceType.chargesSubscription) {
        const direction = lesson.group.direction
        oneOffBase = new Prisma.Decimal(direction.singleVisitPrice ?? direction.lessonPrice)
        newChargeAmount = oneOffPriceWithDiscount(oneOffBase, oneOffClient?.discountTemplate ?? null)
      }

      if (existing) {
        att = await tx.attendance.update({
          where: { id: existing.id },
          data: {
            attendanceTypeId: data.attendanceTypeId,
            chargeAmount: newChargeAmount,
            instructorPayAmount,
            instructorPayEnabled,
            scheduledMakeupLessonId,
            isMakeup: isMakeupArrival,
            makeupOfLessonId: sourceMakeupLessonId,
            isPending: false,
            markedBy: employeeId,
            markedAt: new Date(),
          },
        })
      } else {
        att = await tx.attendance.create({
          data: {
            tenantId,
            lessonId,
            subscriptionId: null,
            clientId: data.clientId,
            wardId: data.wardId,
            attendanceTypeId: data.attendanceTypeId,
            chargeAmount: newChargeAmount,
            instructorPayAmount,
            instructorPayEnabled,
            scheduledMakeupLessonId,
            isMakeup: isMakeupArrival,
            makeupOfLessonId: sourceMakeupLessonId,
            isPending: false,
            markedBy: employeeId,
            markedAt: new Date(),
          },
        })
      }

      // Списание со счёта родителя.
      if (newChargeAmount.gt(0)) {
        await applyBalanceDelta(tx, {
          tenantId,
          clientId: data.clientId,
          delta: newChargeAmount.negated(),
          type: "personal_lesson_charge",
          refs: {
            lessonId,
            attendanceId: att.id,
            directionId: lesson.group.directionId,
          },
          createdBy: employeeId,
          comment: newChargeAmount.lt(oneOffBase) ? "Разовое посещение (со скидкой)" : "Разовое посещение",
        })

        // Lead→Client конверсия как и в обычной отметке (ИЛИ-условие лечит
        // рассинхрон; ЧС не трогаем).
        const oneOffNotFullyActive =
          !!oneOffClient &&
          (oneOffClient.funnelStatus !== "active_client" || oneOffClient.clientStatus !== "active")
        if (oneOffClient && oneOffNotFullyActive && oneOffClient.funnelStatus !== "blacklisted") {
          await tx.client.update({
            where: { id: data.clientId },
            data: {
              funnelStatus: "active_client",
              clientStatus: "active",
              ...(oneOffClient.firstPaidLessonDate ? {} : { firstPaidLessonDate: lesson.date }),
            },
          })
          await recordClientStatusChange(tx, {
            tenantId,
            clientId: data.clientId,
            employeeId,
            funnel: { old: oneOffClient.funnelStatus, new: "active_client" },
            client: { old: oneOffClient.clientStatus, new: "active" },
            reason: "paid_lesson",
          })
        }
      }
    }

    // Q1 (Авто «Отработано»): «Был» на занятии-отработке → первоначальное
    // (пропущенное) занятие переводим из «Назначена отработка» в «Отработано».
    // Деньги/факт не двигаем — фактическое списание/ЗП на ЭТОЙ реальной отработке
    // (present + isMakeup). scheduledMakeupLessonId исходной строки сохраняем:
    // по нему рисуется плашка-ссылка и корректно откатывается «Не был» на L2.
    // Побочно снимает блокировку отчисления исходного абонемента (обязательство
    // закрыто).
    if (
      isMakeupArrival &&
      attendanceType.code === "present" &&
      virtualMakeup &&
      virtualMakeup.attendanceType.code === "makeup_scheduled"
    ) {
      const makeupMarker = await tx.attendanceType.findFirst({
        where: { code: "makeup", OR: [{ tenantId: null }, { tenantId }], isActive: true },
        select: { id: true },
      })
      if (makeupMarker) {
        await tx.attendance.update({
          where: { id: virtualMakeup.id },
          data: { attendanceTypeId: makeupMarker.id },
        })
      }
    }

    // Схемы per_lesson/floating: раскладка ЗП зависит от итогового состава
    // занятия, а не от порядка отметок — пересчитываем целиком (внутри же
    // net-компенсация, если начисление уменьшилось после выплаты ЗП).
    await reallocateLessonPay(tx, { tenantId, lessonId })

    return att
  })

  if (attendance) {
    logAudit({
      tenantId,
      employeeId,
      action: "create",
      entityType: "Attendance",
      entityId: attendance.id,
      changes: { lessonId: { new: lessonId }, clientId: { new: data.clientId }, attendanceTypeId: { new: data.attendanceTypeId } },
      req,
    })
  } else if (virtualMakeup) {
    // Отработка отменена — фиксируем удаление записи makeup_scheduled на L1.
    logAudit({
      tenantId,
      employeeId,
      action: "delete",
      entityType: "Attendance",
      entityId: virtualMakeup.id,
      changes: { reason: { new: "makeup_cancelled" }, targetLessonId: { new: lessonId } },
      req,
    })
  }

  // Ф7: «Не был» на виртуальной отработке — создаём задачу админу переназначить.
  if (isMakeupArrival && attendanceType.code === "no_show" && virtualMakeup) {
    const wardName = virtualMakeupWard
      ? [virtualMakeupWard.lastName, virtualMakeupWard.firstName].filter(Boolean).join(" ")
      : ""
    const clientName = [virtualMakeup.client.lastName, virtualMakeup.client.firstName].filter(Boolean).join(" ")
    const childDisplayName = wardName || clientName || "Без имени"
    await createMissedMakeupTask(db, {
      tenantId,
      clientId: data.clientId,
      childDisplayName,
      sourceLessonDate: virtualMakeup.lesson.date,
      sourceDirectionName: virtualMakeup.lesson.group.direction.name,
      targetLessonDate: new Date(lesson.date),
      targetDirectionName: lesson.group.direction.name,
      reason: "no_show",
    })
  }

  return NextResponse.json(attendance)
}

// PUT: Mark ALL students as present (bulk)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = (session.user as any).tenantId
  const employeeId = (session.user as any).employeeId

  const body = await req.json()
  const parsed = bulkSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const role = (session.user as any).role
  // Роль «только чтение» не отмечает (UI это уже скрывает; защищаем API).
  if (role === "readonly") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    include: {
      group: { include: { direction: true } },
    },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  // ADM-04: access check.
  {
    const allowedBranchIds = (session.user as any).allowedBranchIds as string[] | null | undefined
    const scope = branchScopeFromSession(allowedBranchIds)
    if (role === "instructor") {
      if (!canAccessLessonAsInstructor(lesson, employeeId)) {
        return NextResponse.json({ error: "Нет доступа к этому занятию" }, { status: 403 })
      }
    } else if (!canAccessBranch(lesson.group.branchId, scope)) {
      return NextResponse.json({ error: "Нет доступа к филиалу этого занятия" }, { status: 403 })
    }
  }

  const attendanceType = await db.attendanceType.findFirst({
    where: {
      id: parsed.data.attendanceTypeId,
      OR: [{ tenantId: null }, { tenantId }],
      isActive: true,
    },
  })
  if (!attendanceType) return NextResponse.json({ error: "Тип посещения не найден" }, { status: 404 })

  // Пер-организационный оверрайд системного типа (баг #82): отключение + доступ роли.
  const typeOverride = await db.attendanceTypeWithdrawalOverride.findUnique({
    where: { tenantId_attendanceTypeId: { tenantId, attendanceTypeId: attendanceType.id } },
    select: { isDisabled: true, availableToInstructor: true, availableToAdmin: true },
  })
  if (typeOverride?.isDisabled) {
    return NextResponse.json(
      { error: `Тип «${attendanceType.name}» отключён в настройках организации.` },
      { status: 400 },
    )
  }

  // Доступ роли к типу: инструктор → availableToInstructor, админ → availableToAdmin.
  // Значение — эффективное для центра (оверрайд имеет приоритет над общей строкой).
  // Управляющий и владелец видят/ставят всё.
  const effAvailableToInstructor = typeOverride?.availableToInstructor ?? attendanceType.availableToInstructor
  const effAvailableToAdmin = typeOverride?.availableToAdmin ?? attendanceType.availableToAdmin
  if (role === "instructor" && !effAvailableToInstructor) {
    return NextResponse.json(
      { error: `Тип «${attendanceType.name}» не доступен инструктору. Обратитесь к администратору.` },
      { status: 403 }
    )
  }
  if (role === "admin" && !effAvailableToAdmin) {
    return NextResponse.json(
      { error: `Тип «${attendanceType.name}» не доступен администратору в этом центре.` },
      { status: 403 }
    )
  }

  // Проверка закрытия периода
  if (await isPeriodLocked(tenantId, new Date(lesson.date), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  // Состав занятия (для «Отметить всех») по дате занятия. Дата = граница состава:
  // активные + отчисленные/переведённые позже даты занятия (withdrawnAt > date),
  // чтобы ученик, выбывший ПОСЛЕ этого занятия, в нём ещё участвовал.
  // isActive=false без withdrawnAt не бывает.
  // Дата состава: для перенесённого занятия — исходная дата, иначе текущая.
  const rosterDate = effectiveRosterDate(lesson)
  const enrollmentsRaw = await db.groupEnrollment.findMany({
    where: {
      groupId: lesson.groupId,
      tenantId,
      deletedAt: null,
      ...rosterWhereOnDate(rosterDate),
    },
  })

  // Кандидаты в покрывающие абонементы — по направлению занятия (период — по
  // дате состава). «Отметить всех» отмечает ТОЛЬКО состав по новому правилу:
  // зачисление + покрывающий абонемент (см. roster-filter.ts) — иначе bulk
  // возвращал бы в состав детей без абонемента через разовые списания.
  const subscriptionsAll = await db.subscription.findMany({
    where: coverageSubscriptionsWhere({
      tenantId,
      directionIds: [lesson.group.directionId],
      from: rosterDate,
    }),
  })
  const coveredKeys = await coverageKeysOnDate(db, tenantId, subscriptionsAll, rosterDate, lessonId)
  // Пробное побеждает на своём занятии: «Отметить всех» НЕ отмечает как платного
  // ребёнка с живым пробным на этом занятии (иначе спишет его пробный визит с
  // абонемента и задвоит его в составе). Совпадает с картой занятия/сеткой.
  const trialKeys = await trialKeysForLesson(db, tenantId, lessonId)
  const enrollments = enrollmentsRaw.filter(
    (e) =>
      coveredKeys.has(coverageKey(e.clientId, e.wardId)) &&
      !trialKeys.has(coverageKey(e.clientId, e.wardId)),
  )
  // Для списания/привязки — как раньше: живые абонементы ЭТОЙ группы.
  const subscriptions = subscriptionsAll.filter(
    (s) => s.groupId === lesson.groupId && (s.status === "active" || s.status === "pending"),
  )
  // Остаток занятий по пакетам группы (исключая этот урок) — для выбора пакета к
  // списанию по FIFO/остатку (полностью оплаченный пакет тоже списывается).
  const bulkConsumedById = await consumedPackageLessonsMap(
    db,
    tenantId,
    subscriptions.filter((s) => s.type === "package").map((s) => s.id),
    lessonId,
  )
  // Наборы выбора пакетов группы — чтобы у пакетника списался ИМЕННО тот пакет,
  // что выбрал это занятие (легаси без выбора → gate=true). Состав bulk уже отсечён
  // покрытием (coverageKeysOnDate) — невыбранные сюда не попадают.
  const bulkSel = await loadPackageSelections(
    db,
    tenantId,
    subscriptions.filter((s) => s.type === "package").map((s) => s.id),
  )

  // Резолв ставки ЗП через единую утилиту: приоритет — GroupSalaryRate
  // группы → личное исключение по направлению → дефолт инструктора.
  const effectiveInstructorId = lesson.substituteInstructorId || lesson.instructorId
  const resolvedRate = await resolveRate(db, {
    tenantId,
    groupId: lesson.groupId,
    employeeId: effectiveInstructorId,
    directionId: lesson.group.directionId,
  }, new Date(lesson.date))

  // Режим оплаты пробных — из ставки инструктора этого занятия (перенесено из
  // настройки организации). Резолвим один раз на занятие.
  const bulkTrialMode = lesson.isTrial
    ? await resolveTrialPayMode(db, {
        tenantId,
        groupId: lesson.groupId,
        employeeId: effectiveInstructorId,
        directionId: lesson.group.directionId,
      }, new Date(lesson.date))
    : "none"

  // === Предзагрузка existing attendances (batch вместо N+1) ===
  const existingAttendances = await db.attendance.findMany({
    where: { lessonId, tenantId },
    include: { attendanceType: { select: { chargePercent: true, code: true } } },
  })

  // Ученики, у которых пропуск этого Lesson уже отработан в другой группе:
  // их при «Отметить всех» отмечаем как «Отработано» (без списания, без ЗП), а
  // не «Явка» — иначе будет двойное списание.
  // chargeAmount > 0 — учитываем только успешные отработки (Был на L2).
  // «Не пришёл на отработку» (chargeAmount=0) bulk не должен интерпретировать
  // как «уже отработано», иначе при «Отметить всех — Явка» система ошибочно
  // поставит этим ученикам тип «Отработка» без списания.
  const madeUpResolutions = await db.attendance.findMany({
    where: { tenantId, makeupOfLessonId: lessonId, chargeAmount: { gt: 0 } },
    select: { wardId: true, clientId: true },
  })
  const madeUpKeys = new Set(
    madeUpResolutions.map((m) => `${m.clientId}:${m.wardId || ""}`),
  )
  const makeupType = madeUpKeys.size
    ? await db.attendanceType.findFirst({
        where: { code: "makeup", OR: [{ tenantId: null }, { tenantId }], isActive: true },
      })
    : null

  // === Вся bulk-логика в одной транзакции ===
  const results = await db.$transaction(async (tx) => {
    const atts = []
    // Абонементы, с которых отметку перецепили на другой (переиспользование
    // чужой строки вместо дубля) — их тоже репрайсим в конце.
    const detachedSubIds = new Set<string>()

    for (const enrollment of enrollments) {
      // Пакет — по FIFO/остатку занятий (полностью оплаченный тоже списывается);
      // календарный — первый на месяц (как раньше). Исчерпанный пакет → null →
      // разовое (ветка ниже).
      const mySubs = subscriptions
        .filter(
          (s) => s.clientId === enrollment.clientId && (
            enrollment.wardId ? s.wardId === enrollment.wardId : !s.wardId
          )
        )
        // Пакет с выбором — только если это занятие в его наборе (легаси → gate=true).
        .filter((s) => s.type !== "package" || packageSelectionGate(bulkSel, s.id, lessonId))
      const subscription = pickChargeableSubscription(mySubs, bulkConsumedById)

      // Если у ученика уже стоит «Назначена отработка» — bulk не перетирает,
      // чтобы случайно не отменить назначение и не списать дважды (списание
      // произойдёт когда ребёнок реально придёт на целевое занятие).
      const existingForEnrollment = existingAttendances.find(
        (a) => a.clientId === enrollment.clientId && a.wardId === enrollment.wardId
      )
      if (existingForEnrollment && existingForEnrollment.attendanceType.code === "makeup_scheduled") {
        continue
      }

      // Если этот пропуск уже отработан в другой группе — отмечаем как
      // «Отработано» (chargesSubscription=false, paysInstructor=false).
      const enrollmentKey = `${enrollment.clientId}:${enrollment.wardId || ""}`
      const isAlreadyMadeUp = madeUpKeys.has(enrollmentKey) && !!makeupType
      const effectiveType = isAlreadyMadeUp ? makeupType! : attendanceType

      let chargeAmount = new Prisma.Decimal(0)
      if (effectiveType.chargesSubscription && subscription) {
        // Скидки v2: списание по эффективной цене (цена − скидка за занятие).
        chargeAmount = effectiveLessonPrice(subscription)
      }

      let instructorPayAmount = new Prisma.Decimal(0)
      if (subscription && effectiveType.paysInstructor && resolvedRate) {
        instructorPayAmount = await calcPay(tx, {
          rate: resolvedRate,
          lessonId,
          tenantId,
          currentClientId: enrollment.clientId,
          currentChargeAmount: chargeAmount,
        })
      }

      // Trial lesson instructor pay logic (same as single attendance, fail-closed)
      if (lesson.isTrial && Number(instructorPayAmount) > 0) {
        const allowPay = bulkTrialMode === "all" || (bulkTrialMode === "paid_only" && Number(chargeAmount) > 0)
        if (!allowPay) {
          instructorPayAmount = new Prisma.Decimal(0)
        }
      }

      const subscriptionId = subscription?.id || null

      if (subscriptionId) {
        // Ищем в предзагруженных (вместо N отдельных запросов).
        // Фоллбэк по (клиент, подопечный) — тот же инвариант, что в POST: один
        // ребёнок на занятии = одна отметка. Без него смена резолвнутого
        // абонемента (пакет A исчерпан → FIFO выдал пакет B) не находила прежнюю
        // строку и bulk создавал ВТОРУЮ: занятие списывалось с двух абонементов.
        // Пробные и отработки — отдельные визиты, их не переиспользуем.
        const existing =
          existingAttendances.find((a) => a.subscriptionId === subscriptionId) ??
          existingAttendances.find(
            (a) =>
              a.clientId === enrollment.clientId &&
              a.wardId === enrollment.wardId &&
              !a.isTrial &&
              !a.isMakeup,
          )
        // Абонемент, с которого перецепляем — его тоже надо репрайсить в конце.
        if (existing?.subscriptionId && existing.subscriptionId !== subscriptionId) {
          detachedSubIds.add(existing.subscriptionId)
        }

        // Откат предыдущего возврата (lesson_refund) при смене типа. Только для
        // отметки ПО АБОНЕМЕНТУ: lesson_refund пишется только там, разовое
        // списание уходит с баланса полной суммой (см. POST-путь выше).
        if (existing && existing.subscriptionId && Number(existing.chargeAmount) > 0) {
          const prevRefund = calcRefund(existing.chargeAmount, existing.attendanceType.chargePercent)
          if (prevRefund.gt(0)) {
            await applyBalanceDelta(tx, {
              tenantId,
              clientId: enrollment.clientId,
              delta: prevRefund.negated(),
              type: "attendance_revert",
              refs: { lessonId, attendanceId: existing.id, directionId: lesson.group.directionId },
              createdBy: employeeId,
            })
          }
        }

        let att
        if (existing) {
          // Reverse previous charge
          if (existing.subscriptionId && Number(existing.chargeAmount) > 0) {
            await tx.subscription.update({
              where: { id: existing.subscriptionId },
              data: {
                chargedAmount: { decrement: existing.chargeAmount },
              },
            })
          } else if (!existing.subscriptionId) {
            // «Отметить всех» перецепляет разовую строку на абонемент ровно так
            // же, как одиночная отметка, — и точно так же обязано вернуть
            // разовое списание с баланса родителя.
            await revertOneOffChargeForAttendance(tx, {
              tenantId,
              clientId: enrollment.clientId,
              attendanceId: existing.id,
              lessonId,
              directionId: lesson.group.directionId,
              createdBy: employeeId,
            })
          }

          att = await tx.attendance.update({
            where: { id: existing.id },
            data: {
              // Перецепляем на резолвнутый абонемент: для обычного пути значение
              // не меняется, для переиспользованной чужой строки (фоллбэк выше) —
              // переносит отметку на актуальный абонемент вместо дубля.
              subscriptionId,
              attendanceTypeId: effectiveType.id,
              chargeAmount,
              instructorPayAmount,
              instructorPayEnabled: effectiveType.paysInstructor,
              isPending: false,
              markedBy: employeeId,
              markedAt: new Date(),
            },
          })
        } else {
          att = await tx.attendance.create({
            data: {
              tenantId,
              lessonId,
              subscriptionId,
              clientId: enrollment.clientId,
              wardId: enrollment.wardId,
              attendanceTypeId: effectiveType.id,
              chargeAmount,
              instructorPayAmount,
              instructorPayEnabled: effectiveType.paysInstructor,
              markedBy: employeeId,
              markedAt: new Date(),
            },
          })
        }
        atts.push(att)

        // Debit subscription
        if (effectiveType.chargesSubscription && Number(chargeAmount) > 0) {
          await tx.subscription.update({
            where: { id: subscriptionId },
            data: {
              chargedAmount: { increment: chargeAmount },
            },
          })

          // Возврат недосписанной части при chargePercent < 100
          const refund = calcRefund(chargeAmount, effectiveType.chargePercent)
          if (refund.gt(0)) {
            await applyBalanceDelta(tx, {
              tenantId,
              clientId: enrollment.clientId,
              delta: refund,
              type: "lesson_refund",
              refs: { lessonId, attendanceId: att.id, directionId: lesson.group.directionId, subscriptionId },
              createdBy: employeeId,
            })
          }
        }
      } else {
        // No subscription — разовое посещение: та же семантика, что в одиночной
        // отметке (списание singleVisitPrice ?? lessonPrice с баланса родителя).
        // Раньше bulk писал chargeAmount: 0 без списания — ученики без абонемента
        // «ходили бесплатно», а перезапись заряженной отметки нулём теряла долг.
        const existing = existingAttendances.find(
          (a) => a.clientId === enrollment.clientId &&
            a.wardId === enrollment.wardId &&
            a.subscriptionId === null
        )

        // Постоянная скидка клиента (шаблон в карточке) действует и на разовые
        const oneOffClient = await tx.client.findUnique({
          where: { id: enrollment.clientId },
          include: { discountTemplate: true },
        })

        let oneOffCharge = new Prisma.Decimal(0)
        let oneOffBase = new Prisma.Decimal(0)
        if (effectiveType.chargesSubscription) {
          const direction = lesson.group.direction
          oneOffBase = new Prisma.Decimal(direction.singleVisitPrice ?? direction.lessonPrice)
          oneOffCharge = oneOffPriceWithDiscount(oneOffBase, oneOffClient?.discountTemplate ?? null)
        }

        // ЗП инструктора — от суммы разового списания (как в одиночной отметке)
        if (effectiveType.paysInstructor && resolvedRate) {
          instructorPayAmount = await calcPay(tx, {
            rate: resolvedRate,
            lessonId,
            tenantId,
            currentClientId: enrollment.clientId,
            currentChargeAmount: oneOffCharge,
          })
          if (lesson.isTrial && Number(instructorPayAmount) > 0) {
            const allowPay = bulkTrialMode === "all" || (bulkTrialMode === "paid_only" && oneOffCharge.gt(0))
            if (!allowPay) instructorPayAmount = new Prisma.Decimal(0)
          }
        }

        // Откат прежнего списания при перезаписи реальной отметки
        if (existing && !existing.isPending && Number(existing.chargeAmount) > 0) {
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: enrollment.clientId,
            delta: existing.chargeAmount,
            type: "attendance_revert",
            refs: { lessonId, attendanceId: existing.id, directionId: lesson.group.directionId },
            createdBy: employeeId,
          })
        }

        let att
        if (existing) {
          att = await tx.attendance.update({
            where: { id: existing.id },
            data: {
              attendanceTypeId: effectiveType.id,
              chargeAmount: oneOffCharge,
              instructorPayAmount,
              instructorPayEnabled: effectiveType.paysInstructor,
              isPending: false,
              markedBy: employeeId,
              markedAt: new Date(),
            },
          })
        } else {
          att = await tx.attendance.create({
            data: {
              tenantId,
              lessonId,
              subscriptionId: null,
              clientId: enrollment.clientId,
              wardId: enrollment.wardId,
              attendanceTypeId: effectiveType.id,
              chargeAmount: oneOffCharge,
              instructorPayAmount,
              instructorPayEnabled: effectiveType.paysInstructor,
              isPending: false,
              markedBy: employeeId,
              markedAt: new Date(),
            },
          })
        }
        atts.push(att)

        // Списание со счёта родителя + Lead→Client конверсия (как в одиночной отметке)
        if (oneOffCharge.gt(0)) {
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: enrollment.clientId,
            delta: oneOffCharge.negated(),
            type: "personal_lesson_charge",
            refs: { lessonId, attendanceId: att.id, directionId: lesson.group.directionId },
            createdBy: employeeId,
            comment: oneOffCharge.lt(oneOffBase) ? "Разовое посещение (со скидкой)" : "Разовое посещение",
          })

          const oneOffNotFullyActive =
            !!oneOffClient &&
            (oneOffClient.funnelStatus !== "active_client" || oneOffClient.clientStatus !== "active")
          if (oneOffClient && oneOffNotFullyActive && oneOffClient.funnelStatus !== "blacklisted") {
            await tx.client.update({
              where: { id: oneOffClient.id },
              data: {
                funnelStatus: "active_client",
                clientStatus: "active",
                ...(oneOffClient.firstPaidLessonDate ? {} : { firstPaidLessonDate: lesson.date }),
              },
            })
            await recordClientStatusChange(tx, {
              tenantId,
              clientId: oneOffClient.id,
              employeeId,
              funnel: { old: oneOffClient.funnelStatus, new: "active_client" },
              client: { old: oneOffClient.clientStatus, new: "active" },
              reason: "paid_lesson",
            })
          }
        }
      }
    }

    // Массовая отметка могла заменить несписывающую отметку (Уваж./Перерасчёт)
    // списывающей «Явкой» — расход слотов и chargedAmount изменились, выравниваем
    // finalAmount/balance затронутых абонементов (раньше bulk не пересчитывал).
    const touchedSubIds = new Set<string>(detachedSubIds)
    for (const a of atts) {
      if (a.subscriptionId) touchedSubIds.add(a.subscriptionId)
    }
    for (const sid of touchedSubIds) {
      await repriceSubscription(tx, { tenantId, subscriptionId: sid, createdBy: employeeId })
    }

    // Схемы per_lesson/floating: раскладка ЗП зависит от итогового состава —
    // пересчитываем целиком после массовой отметки.
    await reallocateLessonPay(tx, { tenantId, lessonId })

    return atts
  })

  logAudit({
    tenantId,
    employeeId,
    action: "create",
    entityType: "Attendance",
    entityId: lessonId,
    changes: { bulk: { new: true }, count: { new: results.length }, attendanceTypeId: { new: parsed.data.attendanceTypeId } },
    req,
  })

  return NextResponse.json({ count: results.length, attendances: results })
}

// DELETE: Сбросить отметку — вернуть строку в состояние «Не отмечен».
// Удаляет Attendance, откатывает списание с абонемента (если было).
// Принимает либо attendanceId, либо (clientId + wardId) — для поиска по ученику.
//
// purge=true — полное удаление attendance без возврата в placeholder. Используется
// для разовых учеников: оператор хочет совсем убрать ребёнка с занятия.
const deleteSchema = z.object({
  attendanceId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  wardId: z.string().uuid().nullable().optional(),
  purge: z.boolean().optional(),
}).refine((d) => d.attendanceId || d.clientId, {
  message: "Нужен attendanceId или clientId",
})

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = (session.user as any).tenantId
  const employeeId = (session.user as any).employeeId
  const role = (session.user as any).role
  // Роль «только чтение» не отмечает (UI это уже скрывает; защищаем API).
  if (role === "readonly") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    select: {
      id: true,
      date: true,
      groupId: true,
      instructorId: true,
      substituteInstructorId: true,
      group: { select: { branchId: true } },
    },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  // ADM-04: access check.
  {
    const allowedBranchIds = (session.user as any).allowedBranchIds as string[] | null | undefined
    const scope = branchScopeFromSession(allowedBranchIds)
    if (role === "instructor") {
      if (!canAccessLessonAsInstructor(lesson, employeeId)) {
        return NextResponse.json({ error: "Нет доступа к этому занятию" }, { status: 403 })
      }
    } else if (!canAccessBranch(lesson.group.branchId, scope)) {
      return NextResponse.json({ error: "Нет доступа к филиалу этого занятия" }, { status: 403 })
    }
  }

  if (await isPeriodLocked(tenantId, new Date(lesson.date), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  const existing = data.attendanceId
    ? await db.attendance.findFirst({
        where: { id: data.attendanceId, lessonId, tenantId },
        include: {
          attendanceType: { select: { chargePercent: true } },
          lesson: { select: { group: { select: { directionId: true } } } },
        },
      })
    : await db.attendance.findFirst({
        where: {
          lessonId,
          tenantId,
          clientId: data.clientId,
          wardId: data.wardId ?? null,
        },
        // Фолбэк без attendanceId (все UI-поверхности шлют id, но не все клиенты
        // им располагают): без orderBy выбор строки недетерминирован. Берём
        // финансово «нагруженную» — если исторический дубль всё же есть, снимать
        // надо ту, что несёт списание и ЗП, а не пустую заглушку.
        orderBy: [
          { chargeAmount: "desc" },
          { instructorPayAmount: "desc" },
          { isPending: "asc" },
          { markedAt: "desc" },
        ],
        include: {
          attendanceType: { select: { chargePercent: true } },
          lesson: { select: { group: { select: { directionId: true } } } },
        },
      })

  if (!existing) return NextResponse.json({ error: "Отметка не найдена" }, { status: 404 })

  // Пробное (isTrial=true) сбрасывается через /api/trial-lessons/[id] — там своя логика
  if (existing.isTrial) {
    return NextResponse.json(
      { error: "Снимите отметку пробного через выпадашку статуса пробного" },
      { status: 400 }
    )
  }

  // Замок отработанного абонемента: удалять отметку на отчисленном/закрытом
  // абонементе нельзя — деньги по нему сведены при закрытии, а откат списания
  // здесь их не вернёт корректно (кейс Валеевой: долг остался, занятие переотметили).
  const delWord = await lockedSubWord(tenantId, [existing.subscriptionId])
  if (delWord) return lockedMarkResponse(delWord)

  // Снятие отметки «Был» на отработке — только админ+.
  // ЗП могла быть уже выплачена инструктору; решение об откате принимает старший.
  if (
    existing.isMakeup &&
    Number(existing.chargeAmount) > 0 &&
    role === "instructor"
  ) {
    return NextResponse.json(
      { error: "Снять отметку «Был» на отработке может только админ, управляющий или владелец" },
      { status: 403 },
    )
  }

  // Симметрия «Не отмечен» на отработке (isMakeup) с веткой «Не был» (Ф8): отметка
  // отработки на L2 связана с исходным занятием L1 (scheduledMakeupLessonId=L2).
  // При «Был» L1 был переведён в «Отработано» (makeup) — при отмене возвращаем его
  // в «Назначена отработка», чтобы отработка снова считалась назначенной (ребёнок
  // вернётся виртуальной строкой на L2, блокировка отчисления восстановится), а не
  // осталась осиротевшей «Отработано» без реальной отработки.
  let flipBackSourceId: string | null = null
  if (existing.isMakeup) {
    const source = await db.attendance.findFirst({
      where: {
        tenantId,
        scheduledMakeupLessonId: lessonId,
        clientId: existing.clientId,
        wardId: existing.wardId,
        attendanceType: { code: "makeup" },
      },
      select: { id: true },
    })
    flipBackSourceId = source?.id ?? null
  }

  // Если у ребёнка есть active enrollment в группе — DELETE удаляет attendance
  // (вернёт строку в «Не отмечен» через enrollment). Если enrollment нет —
  // это «разовый» ученик; без явного purge=true мы возвращаем attendance в
  // placeholder (isPending=true), чтобы ребёнок остался в списке как «Не отмечен».
  // С purge=true — полное удаление (оператор передумал, убирает разового).
  const hasActiveEnrollment = !!(await db.groupEnrollment.findFirst({
    where: {
      tenantId,
      groupId: lesson.groupId,
      clientId: existing.clientId,
      wardId: existing.wardId,
      isActive: true,
      deletedAt: null,
    },
    select: { id: true },
  }))

  // Отработку (isMakeup) всегда удаляем полностью, а не превращаем в placeholder:
  // ребёнок не член этой группы, его место в занятии — виртуальная строка, которая
  // вернётся через восстановленную «Назначена отработка» на L1.
  const shouldDelete =
    data.purge === true || hasActiveEnrollment || existing.isPending || existing.isMakeup
  // existing.isPending — placeholder без enrollment: «сброс отметки» уже стоит
  // как «Не отмечен», смысла оставлять заглушку нет → удаляем по умолчанию.

  await db.$transaction(async (tx) => {
    // Откат отработки. balance не трогаем — он отражает «долг к оплате»,
    // отработка увеличивает только chargedAmount.
    if (existing.subscriptionId && Number(existing.chargeAmount) > 0) {
      await tx.subscription.update({
        where: { id: existing.subscriptionId },
        data: {
          chargedAmount: { decrement: existing.chargeAmount },
        },
      })
    }

    // Откат списания с баланса родителя (для разовых без абонемента).
    if (!existing.subscriptionId && !existing.isPending && Number(existing.chargeAmount) > 0) {
      await applyBalanceDelta(tx, {
        tenantId,
        clientId: existing.clientId,
        delta: existing.chargeAmount,
        type: "attendance_revert",
        refs: {
          lessonId,
          attendanceId: existing.id,
          directionId: existing.lesson.group.directionId,
        },
        createdBy: employeeId,
      })
    }

    // Откат возврата (lesson_refund) на баланс клиента
    if (existing.subscriptionId && Number(existing.chargeAmount) > 0) {
      const refund = calcRefund(existing.chargeAmount, existing.attendanceType.chargePercent)
      if (refund.gt(0)) {
        await applyBalanceDelta(tx, {
          tenantId,
          clientId: existing.clientId,
          delta: refund.negated(),
          type: "attendance_revert",
          refs: {
            lessonId,
            attendanceId: existing.id,
            directionId: existing.lesson.group.directionId,
            subscriptionId: existing.subscriptionId,
          },
          createdBy: employeeId,
        })
      }
    }

    if (shouldDelete) {
      await tx.attendance.delete({ where: { id: existing.id } })
    } else {
      // Разовый ученик без enrollment — оставляем placeholder. Тип-заглушка
      // «present», все суммы и метки обнуляем; isPending=true.
      const presentType = await tx.attendanceType.findFirst({
        where: { code: "present", OR: [{ tenantId: null }, { tenantId }], isActive: true },
        select: { id: true },
      })
      await tx.attendance.update({
        where: { id: existing.id },
        data: {
          attendanceTypeId: presentType?.id ?? existing.attendanceTypeId,
          chargeAmount: 0,
          instructorPayAmount: 0,
          subscriptionId: null,
          absenceReasonId: null,
          scheduledMakeupLessonId: null,
          isPending: true,
          markedBy: null,
          markedAt: null,
        },
      })
    }

    // Возврат исходного занятия L1 в «Назначена отработка» (см. flipBackSourceId):
    // отработка отменена, но назначение сохраняется — ребёнок снова ждёт отработки.
    if (flipBackSourceId) {
      const scheduledType = await tx.attendanceType.findFirst({
        where: { code: "makeup_scheduled", OR: [{ tenantId: null }, { tenantId }], isActive: true },
        select: { id: true },
      })
      if (scheduledType) {
        await tx.attendance.update({
          where: { id: flipBackSourceId },
          data: { attendanceTypeId: scheduledType.id },
        })
      }
    }

    // Схемы per_lesson/floating: удалённая отметка могла нести ставку занятия —
    // пересчитываем раскладку целиком. Снятие отметки само по себе убирает
    // начисление; компенсировать выплаченное премией НЕ нужно — переплата
    // уедет в минусовое «Доначислено» и вычтется из следующей выплаты.
    await reallocateLessonPay(tx, { tenantId, lessonId })

    if (existing.subscriptionId) {
      // Занятие вернулось в «оставшиеся» — повторное списание пойдёт по текущей
      // эффективной цене; выравниваем finalAmount/balance. Пересчёт нужен и для
      // несписывающих отметок (Уваж. пропуск/Перерасчёт расходовали слот
      // календарного абонемента — после удаления занятие снова ждёт оплату).
      // Строго ПОСЛЕ delete/update: иначе пересчёт считает удаляемую строку живой.
      await repriceSubscription(tx, {
        tenantId,
        subscriptionId: existing.subscriptionId,
        createdBy: employeeId,
      })
    }
  })

  logAudit({
    tenantId,
    employeeId,
    action: "delete",
    entityType: "Attendance",
    entityId: existing.id,
    changes: {
      lessonId: { old: lessonId },
      clientId: { old: existing.clientId },
      attendanceTypeId: { old: existing.attendanceTypeId },
    },
    req,
  })

  return NextResponse.json({ ok: true })
}

// PATCH: Update absence reason on an attendance record
const patchSchema = z.object({
  attendanceId: z.string().uuid(),
  absenceReasonId: z.string().uuid().nullable(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = (session.user as any).tenantId
  const employeeId = (session.user as any).employeeId
  const role = (session.user as any).role
  // Роль «только чтение» не отмечает (UI это уже скрывает; защищаем API).
  if (role === "readonly") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Ошибка валидации" }, { status: 400 })
  }

  // ADM-04: access check.
  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    select: {
      instructorId: true,
      substituteInstructorId: true,
      group: { select: { branchId: true } },
    },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })
  {
    const allowedBranchIds = (session.user as any).allowedBranchIds as string[] | null | undefined
    const scope = branchScopeFromSession(allowedBranchIds)
    if (role === "instructor") {
      if (!canAccessLessonAsInstructor(lesson, employeeId)) {
        return NextResponse.json({ error: "Нет доступа к этому занятию" }, { status: 403 })
      }
    } else if (!canAccessBranch(lesson.group.branchId, scope)) {
      return NextResponse.json({ error: "Нет доступа к филиалу этого занятия" }, { status: 403 })
    }
  }

  const existing = await db.attendance.findFirst({
    where: { id: parsed.data.attendanceId, lessonId, tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Отметка не найдена" }, { status: 404 })

  // Замок отработанного абонемента: отметку в отчисленном/закрытом абонементе
  // не трогаем (в т.ч. причину пропуска) — он полностью отработан и заблокирован.
  const patchWord = await lockedSubWord(tenantId, [existing.subscriptionId])
  if (patchWord) return lockedMarkResponse(patchWord)

  const updated = await db.attendance.update({
    where: { id: parsed.data.attendanceId },
    data: { absenceReasonId: parsed.data.absenceReasonId },
  })

  return NextResponse.json(updated)
}
