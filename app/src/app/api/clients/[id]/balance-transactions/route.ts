import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requirePermission } from "@/lib/api-permissions"
import { branchScopeFromSession } from "@/lib/branch-scope"
import { scopeClientByBranch } from "@/lib/client-segments"

// Полный журнал операций с балансом клиента (ClientBalanceTransaction). В отличие
// от старой вкладки, которая читала только Payment, здесь видны ВСЕ движения
// баланса: пополнения, переносы в абонемент, возвраты, а также операции без
// Payment — разовые посещения, корректировки, закрытия абонементов, возвраты за
// занятие/по скидке, отмены посещений («Операции с балансом»).
const TYPE_LABELS: Record<string, string> = {
  payment_received: "Пополнение баланса",
  subscription_remainder: "Остаток абонемента",
  refund: "Возврат средств",
  correction: "Корректировка баланса",
  transfer_to_subscription: "Перенос в абонемент",
  subscription_closed_refund: "Закрытие абонемента",
  lesson_refund: "Возврат за занятие",
  personal_lesson_charge: "Разовое посещение",
  attendance_revert: "Отмена посещения",
  discount_refund: "Возврат по скидке",
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("clients.view")
  if (!guard.ok) return guard.response
  const user = guard.session!.user as { role: string; tenantId: string; allowedBranchIds: string[] | null }
  const { id: clientId } = await params

  // ADM-04: админ с привязкой к филиалам видит только «своих» клиентов — чужой
  // клиент для него «не найден» (как в списках). Owner/manager — scope пустой.
  const scope = branchScopeFromSession(user.allowedBranchIds)
  const client = await db.client.findFirst({
    where: { id: clientId, tenantId: user.tenantId, ...scopeClientByBranch(scope) },
    select: { id: true },
  })
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  const txns = await db.clientBalanceTransaction.findMany({
    where: {
      tenantId: user.tenantId,
      clientId,
      // Легаси-тип subscription_issued: старая «долговая» модель, откачена из
      // реального баланса миграцией 20260608100000, но строки оставлены для
      // истории. Как и /timeline, не показываем — иначе фантомный долг.
      type: { not: "subscription_issued" },
    },
    include: {
      subscription: {
        select: {
          periodYear: true,
          periodMonth: true,
          direction: { select: { name: true } },
        },
      },
      direction: { select: { name: true } },
      lesson: { select: { date: true, startTime: true } },
      payment: { select: { date: true } },
    },
    // Забираем 300 последних ПО ВВОДУ, а отдаём отсортированными по дате
    // документа (см. ниже). id как вторичный ключ — детерминированный порядок
    // для операций одной транзакции (общий createdAt), иначе строки одной мс
    // шли бы недетерминированно.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 300,
  })

  const rows = txns.map((t) => {
    // Направление берём от абонемента, иначе — собственная ссылка транзакции
    // (разовое посещение привязано к direction напрямую).
    const subLabel = t.subscription
      ? `${t.subscription.direction.name} (${String(t.subscription.periodMonth).padStart(2, "0")}.${t.subscription.periodYear})`
      : t.direction?.name || null
    const lessonLabel = t.lesson
      ? `занятие ${t.lesson.date.toLocaleDateString("ru-RU")}${t.lesson.startTime ? ` ${t.lesson.startTime}` : ""}`
      : null
    const detail = [subLabel, lessonLabel, t.comment].filter(Boolean).join(" · ")
    // Дата операции: у зеркальных Payment-строк берём бухгалтерскую дату платежа
    // (её можно задать задним числом), иначе — дату записи в журнал.
    const opDate = t.payment?.date ?? t.createdAt
    return {
      id: t.id,
      type: t.type,
      label: TYPE_LABELS[t.type] || "Операция с балансом",
      amount: Number(t.amount),
      date: opDate.toISOString(),
      detail,
      // Момент ввода записи — только для сортировки, наружу не отдаём.
      _enteredAt: t.createdAt.getTime(),
    }
  })

  // Сортируем по ТОЙ ЖЕ дате, что показываем в колонке «Дата». Раньше порядок
  // шёл по createdAt (момент ввода), а в таблице стоит бухгалтерская дата
  // платежа — её ставят задним числом, и список выглядел перемешанным
  // (18.08 → 06.08 → 11.08 → 06.08…). При равной дате документа выше идут
  // введённые позже — операции одного дня читаются в обратном порядке ввода.
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b._enteredAt - a._enteredAt))

  return NextResponse.json(rows.map(({ _enteredAt, ...r }) => r))
}
