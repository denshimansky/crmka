import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query"] : [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * Выполняет запросы в контексте тенанта (RLS).
 * Устанавливает SET LOCAL app.current_tenant_id перед выполнением fn
 * внутри транзакции, чтобы RLS-политики фильтровали по tenant_id.
 *
 * SET LOCAL действует только внутри текущей транзакции — безопасно
 * при connection pooling.
 *
 * Использование:
 *   const clients = await withTenant(tenantId, () =>
 *     db.client.findMany()
 *   )
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) {
    throw new Error("withTenant: tenantId must be a valid UUID");
  }
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}
