// Ленивый seed системных причин отчисления — дефолтный справочник, который
// должен быть у КАЖДОГО центра «со старта».
//
// Причина при отчислении абонемента обязательна (см. WithdrawalReason в схеме),
// но исторически системный набор был засеян только в референс-орг ДЦ «Умный Я»,
// а в создание тенанта seeding не попал. В итоге у остальных центров справочник
// пуст — и отчислить ученика нельзя, пока владелец вручную не заведёт причину.
//
// Эталон набора — текущие системные причины «Умный Я» (имена и порядок). Флаг
// isActive у «Ушёл с направления» там выключен — это локальная настройка орга;
// в дефолте seed'им ВСЕ активными (центр сам деактивирует ненужные).
//
// Идемпотентность — по имени (без учёта регистра): повторный вызов ничего не
// добавляет; уже заведённую вручную причину с тем же именем не дублируем;
// «Умный Я» (все 6 уже есть) не трогаем. Вызывается при создании партнёра
// (детерминированно) и лениво при GET /api/withdrawal-reasons (бэкфилл
// существующих + гарантия перед отчислением).

import { db } from "@/lib/db"

export const SYSTEM_WITHDRAWAL_REASONS: Array<{ name: string; sortOrder: number }> = [
  { name: "Закончил курс", sortOrder: 1 },
  { name: "Ушёл с направления", sortOrder: 2 },
  { name: "Переезд", sortOrder: 3 },
  { name: "Не подошёл педагог", sortOrder: 4 },
  { name: "Финансы", sortOrder: 5 },
  { name: "Другое", sortOrder: 6 },
]

export async function ensureSystemWithdrawalReasons(tenantId: string): Promise<void> {
  const existing = await db.withdrawalReason.findMany({
    where: { tenantId },
    select: { name: true },
  })
  const taken = new Set(existing.map((r) => r.name.trim().toLowerCase()))

  const toCreate = SYSTEM_WITHDRAWAL_REASONS.filter(
    (r) => !taken.has(r.name.toLowerCase()),
  )
  if (toCreate.length === 0) return

  await db.withdrawalReason.createMany({
    data: toCreate.map((r) => ({
      tenantId,
      name: r.name,
      isSystem: true,
      isActive: true,
      sortOrder: r.sortOrder,
    })),
  })
}
