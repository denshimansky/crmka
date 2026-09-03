import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import {
  reconcileDayToNonWorking,
  findNonWorkingBlockers,
  nonWorkingBlockReason,
} from "@/lib/schedule/reconcile-calendar-day"
import { isPeriodLocked } from "@/lib/period-check"
import { branchScopeFromSession, canAccessBranch, isUnscoped } from "@/lib/branch-scope"
import { logAudit } from "@/lib/audit"

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Формат даты: YYYY-MM-DD"),
  branchId: z.string().uuid().optional(),
  reason: z.string().min(1, "Укажите причину отмены"),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // Как одиночное удаление занятия (та же операция «удалить + пересчитать»):
  // owner/manager/admin. Раньше guard'а не было — теперь действие удаляет
  // занятия и двигает деньги, поэтому ограничиваем.
  if (
    session.user.role !== "owner" &&
    session.user.role !== "manager" &&
    session.user.role !== "admin"
  ) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const tenantId = session.user.tenantId
  const createdBy = session.user.employeeId ?? null
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 }
    )
  }

  const { date, branchId, reason } = parsed.data
  const targetDate = new Date(date + "T00:00:00.000Z")

  // Филиал: администратор с ограниченным доступом не должен снимать день в чужом
  // филиале, а отмену по ВСЕЙ организации ему не даём вовсе — она затрагивает
  // филиалы, которых он не видит.
  const scope = branchScopeFromSession(session.user.allowedBranchIds)
  if (branchId) {
    if (!canAccessBranch(branchId, scope)) {
      return NextResponse.json({ error: "Нет доступа к этому филиалу" }, { status: 403 })
    }
  } else if (!isUnscoped(scope) && !scope.coversAllBranches) {
    return NextResponse.json(
      { error: "Отмена дня по всей организации доступна только при доступе ко всем филиалам. Выберите свой филиал." },
      { status: 403 },
    )
  }

  // Закрытый период: удаление занятий двигает деньги (пересчёт абонементов),
  // поэтому тот же замок, что у одиночного удаления занятия.
  if (await isPeriodLocked(tenantId, targetDate, session.user.role)) {
    return NextResponse.json(
      { error: "Период закрыт. Обратитесь к владельцу или управляющему." },
      { status: 403 },
    )
  }

  // Пока в дне есть отметки или активные пробные, день применился бы наполовину:
  // такие занятия reconcileDayToNonWorking намеренно НЕ удаляет, а ответ считает
  // только удалённые — админ видел «отменено N» и был уверен, что день снят
  // целиком. Плюс для отмены по всей организации: при возврате дня в рабочие
  // генератор доложил бы дубли рядом с уцелевшими занятиями.
  // Проверку ведём в границах того же среза, что и отмена: филиальная отмена
  // не должна упираться в пробные соседнего филиала (findNonWorkingBlockers
  // фильтрует по group.branchId).
  const blockers = await findNonWorkingBlockers(db, {
    tenantId,
    date: targetDate,
    branchId: branchId ?? null,
  })
  // По всей организации блокируют и отметки, и пробные: день уходит в
  // производственный календарь, и при возврате в рабочие генератор доложил бы
  // дубли рядом с уцелевшими занятиями.
  // По одному филиалу календарь не трогается и регенерации не будет, поэтому
  // отмеченные занятия просто сохраняются (перечислены в ответе) — блокировать
  // из-за них нельзя: иначе утреннее отмеченное занятие запирало бы отмену
  // остатка дня. Активные пробные блокируют и здесь: они теряют занятие, а
  // отменить пробное можно только в «Продажах».
  const blockReason = branchId
    ? nonWorkingBlockReason({ markedLessons: 0, trialLessons: blockers.trialLessons })
    : nonWorkingBlockReason(blockers)
  if (blockReason) {
    return NextResponse.json(
      { error: blockReason, lessons: blockers.details },
      { status: 409 },
    )
  }

  // Удаляем занятия дня без реальных отметок и пересчитываем абонементы
  // (переплата возвращается на баланс клиента, долг — начисляется). Правило
  // заказчика: «Отменить день» приводит абонементы в соответствие расписанию.
  const result = await reconcileDayToNonWorking(db, {
    tenantId,
    date: targetDate,
    branchId: branchId ?? null,
    createdBy,
  })

  // Отмена по всей организации (без филиала) — помечаем день нерабочим в
  // производственном календаре с причиной, чтобы повторная генерация не вернула
  // занятия обратно. При отмене по одному филиалу календарь (общий по орг) не
  // трогаем — это частичная отмена дня.
  if (!branchId) {
    await db.productionCalendar.upsert({
      where: { tenantId_date: { tenantId, date: targetDate } },
      update: { isWorking: false, comment: reason },
      create: { tenantId, date: targetDate, isWorking: false, comment: reason },
    })
  }

  // Массовое удаление занятий раньше не оставляло следа (архива у него нет —
  // решение владельца) — пишем хотя бы одну запись в историю.
  logAudit({
    tenantId,
    employeeId: createdBy,
    action: "delete",
    entityType: "Lesson",
    entityId: `bulk-${date}${branchId ? `-${branchId}` : ""}`,
    changes: {
      date: { new: date },
      branchId: { new: branchId ?? null },
      reason: { new: reason },
      deleted: { new: result.deleted },
      kept: { new: blockers.details.length },
    },
    req,
  })

  return NextResponse.json({
    deleted: result.deleted,
    subscriptionsUpdated: result.subscriptionsUpdated,
    // Занятия с отметками отмена дня не удаляет — раньше об этом не сообщалось,
    // и «отменено N» читалось как «день снят целиком».
    kept: blockers.details,
    date,
    reason,
  })
}
