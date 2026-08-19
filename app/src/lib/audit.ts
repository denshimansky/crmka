import { db } from "@/lib/db"
import type { Prisma, PrismaClient } from "@prisma/client"

type AuditAction = "create" | "update" | "delete"

type AuditTx = Prisma.TransactionClient | PrismaClient

interface AuditParams {
  tenantId: string
  // null — системное действие без сотрудника (крон, вебхук, автоактивация)
  employeeId: string | null
  action: AuditAction
  entityType: string
  entityId: string
  changes?: Record<string, { old?: any; new?: any }> | null
  isAfterPeriodClose?: boolean
  req?: Request
}

/**
 * Записывает действие в audit log.
 * Вызывать ПОСЛЕ успешной мутации (не внутри транзакции — чтобы не блокировать основную операцию).
 */
export async function logAudit(params: AuditParams): Promise<void> {
  try {
    const ipAddress = params.req
      ? params.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        params.req.headers.get("x-real-ip") ||
        undefined
      : undefined

    const userAgent = params.req
      ? params.req.headers.get("user-agent") || undefined
      : undefined

    await db.auditLog.create({
      data: {
        tenantId: params.tenantId,
        employeeId: params.employeeId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        changes: params.changes ?? undefined,
        isAfterPeriodClose: params.isAfterPeriodClose ?? false,
        ipAddress,
        userAgent,
      },
    })
  } catch (e) {
    // Аудит не должен ломать основную операцию
    console.error("[audit] Failed to log:", e)
  }
}

/**
 * Аудит ВНУТРИ транзакции: пишет ту же строку audit_logs, но клиентом `tx`,
 * поэтому запись живёт и умирает вместе с основной мутацией. Нужен там, где
 * событие не имеет смысла без неё — например смена цены абонемента при
 * пересчёте: аудит от откатившегося пересчёта показал бы несуществующее
 * изменение цены.
 *
 * В отличие от logAudit ошибку НЕ глотаем: в PostgreSQL упавший запрос рушит
 * всю транзакцию, и «проглоченная» ошибка всё равно свалила бы основную
 * операцию — но уже с непонятным сообщением. ip/user-agent недоступны (вызов
 * идёт из сервисов, не из route-хендлера).
 */
export async function logAuditTx(
  tx: AuditTx,
  params: {
    tenantId: string
    employeeId?: string | null
    action: AuditAction
    entityType: string
    entityId: string
    changes?: Record<string, { old?: any; new?: any }> | null
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: params.tenantId,
      employeeId: params.employeeId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      changes: params.changes ?? undefined,
    },
  })
}

/**
 * Вычисляет diff между old и new объектами.
 * Возвращает только изменённые поля.
 */
export function diffChanges(
  oldObj: Record<string, any>,
  newObj: Record<string, any>,
  fields: string[]
): Record<string, { old: any; new: any }> | null {
  const changes: Record<string, { old: any; new: any }> = {}
  for (const field of fields) {
    const oldVal = oldObj[field]
    const newVal = newObj[field]
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes[field] = { old: oldVal, new: newVal }
    }
  }
  return Object.keys(changes).length > 0 ? changes : null
}
