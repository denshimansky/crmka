import type { Prisma, PrismaClient, FunnelStatus, ClientWorkStatus } from "@prisma/client"

type Tx = Prisma.TransactionClient | PrismaClient

// Причина смены статуса — суффикс к событию в истории карточки. Позволяет
// отличить «стал активом при первой оплате» от «вернулся кроном» и т.п.
export type ClientStatusChangeReason =
  | "manual" // ручная смена в карточке
  | "created" // создание клиента
  | "import" // импорт базы из 1С
  | "subscription_payment" // оплата абонемента с баланса (на любую сумму)
  | "paid_lesson" // отметка платного занятия
  | "reactivated" // повторная оплата/активация вернула выбывшего
  | "withdrawal" // отчисление (нет активных абонементов)
  | "cron_inactive" // крон: неактивность 30+ дней
  | "cron_reactivated" // крон: возврат при активном абонементе
  | "application_processed" // обработка заявки в воронке
  | "subscription_ended_unpaid" // абонемент закрыт без оплаты → назад в воронку
  | "data_correction" // ручная коррекция данных

// Русские подписи причины. null → суффикс не показываем (обычная ручная смена:
// автор и так виден, лишний ярлык не нужен).
export const CLIENT_STATUS_CHANGE_REASON_LABELS: Record<ClientStatusChangeReason, string | null> = {
  manual: null,
  created: "Создание",
  import: "Импорт базы",
  subscription_payment: "Оплата абонемента",
  paid_lesson: "Платное занятие",
  reactivated: "Возврат клиента",
  withdrawal: "Отчисление",
  cron_inactive: "Автоматически: неактивность",
  cron_reactivated: "Автоматически: возврат",
  application_processed: "Обработка заявки",
  subscription_ended_unpaid: "Абонемент закрыт без оплаты",
  data_correction: "Коррекция данных",
}

/**
 * Пишет в историю карточки клиента событие смены статуса воронки и/или статуса
 * клиента. Читается таймлайном GET /api/clients/[id]/timeline (kind:
 * "status_change") — там же маппинг enum→русский и подпись причины.
 *
 * Вызывать ВНУТРИ той же транзакции, что и сама смена статуса, — чтобы история
 * не расходилась с данными (откат мутации откатывает и запись истории).
 * employeeId=null — системное действие (крон, вебхук, автоактивация) → в ленте
 * автор «Система». Ничего не пишет, если ни funnel, ни client не изменились.
 */
export async function recordClientStatusChange(
  tx: Tx,
  params: {
    tenantId: string
    clientId: string
    employeeId?: string | null
    // old=null — событие «создан/импортирован как X» (прежнего статуса не было).
    funnel?: { old: FunnelStatus | null; new: FunnelStatus }
    client?: { old: ClientWorkStatus | null; new: ClientWorkStatus | null }
    reason: ClientStatusChangeReason
  },
): Promise<void> {
  const changes: Record<string, unknown> = {}
  if (params.funnel && params.funnel.old !== params.funnel.new) {
    changes.funnelStatus = { old: params.funnel.old, new: params.funnel.new }
  }
  if (params.client && (params.client.old ?? null) !== (params.client.new ?? null)) {
    changes.clientStatus = { old: params.client.old ?? null, new: params.client.new ?? null }
  }
  if (Object.keys(changes).length === 0) return
  changes.reason = params.reason

  await tx.auditLog.create({
    data: {
      tenantId: params.tenantId,
      employeeId: params.employeeId ?? null,
      action: "update",
      entityType: "Client",
      entityId: params.clientId,
      changes: changes as unknown as Prisma.InputJsonValue,
    },
  })
}
