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

  // Отмена всего дня (без филиала) помечает его нерабочим в производственном
  // календаре — то же действие, что и галка на странице календаря, и тот же
  // запрет: пока в дне есть отметки/активные пробные, день применился бы
  // наполовину (отмеченные занятия остались бы), а при возврате дня в рабочие
  // генератор доложил бы дубли рядом с ними. Отмена по одному филиалу календарь
  // не трогает — там регенерации не будет, и запрет не нужен.
  if (!branchId) {
    const blockers = await findNonWorkingBlockers(db, { tenantId, date: targetDate })
    const blockReason = nonWorkingBlockReason(blockers)
    if (blockReason) {
      return NextResponse.json(
        { error: blockReason, lessons: blockers.details },
        { status: 409 },
      )
    }
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

  return NextResponse.json({
    deleted: result.deleted,
    subscriptionsUpdated: result.subscriptionsUpdated,
    date,
    reason,
  })
}
