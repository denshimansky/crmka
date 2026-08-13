// ADM-04 + модель Анны (13.08.2026): видимость клиента админом филиала.
//
// МОДЕЛЬ: жёсткая ручная привязка 1–2 филиалов в карточке клиента
// (Client.branchId — поле 1, Client.secondBranchId — поле 2). Админ филиала X
// видит клиента, если выполнено хотя бы одно:
//   • X = branchId ИЛИ X = secondBranchId (ручная привязка, симметрично —
//     порядок полей не важен);
//   • у клиента есть живой (pending/active) абонемент в группе филиала X —
//     несносимая СТРАХОВКА (решение владельца 13.08): филиал, где клиент сейчас
//     реально занимается и платит, не должен ослепнуть, даже если поля в
//     карточке не заполнены или устарели.
//
// Безфилиальный клиент (оба поля пусты и нет живого абонемента) частичному
// scope НЕ виден — только владельцу/управляющему и админу, у кого отмечены ВСЕ
// филиалы тенанта (BranchScope.coversAllBranches, см. getBranchScope).
//
// Заменяет прежнюю сегментную модель (баг #79: last/prev + фолбэки «видят все»
// для лид/архив/ЧС/нецелевой). Теперь принадлежность филиалу задаётся ВРУЧНУЮ,
// а не выводится из активности. Денормализованные lastBranchId/prevBranchId
// остаются в схеме как источник для бэкфилла/подсказок, но видимость НЕ
// определяют. Единая точка правды — clientInBranch (её же использует явный
// дропдаун «Филиал» на списках, чтобы фильтр и scope не расходились).

import type { Prisma } from "@prisma/client"
import { isUnscoped, type BranchScope } from "@/lib/branch-scope"

/**
 * Предикат «клиент принадлежит одному из филиалов `branchIds`».
 * ЕДИНОЕ правило и для scope админа (scopeClientByBranch), и для явного фильтра
 * «Филиал» на списках клиентов (contacts/sales) — чтобы они не расходились.
 * Пустой `branchIds` даёт предикат, не матчащий никого (deny-семантика).
 */
export function clientInBranch(branchIds: string[]): Prisma.ClientWhereInput {
  const inIds = { in: branchIds }
  return {
    OR: [
      { branchId: inIds },
      { secondBranchId: inIds },
      // Страховка: живой (pending/active) абонемент в группе филиала.
      {
        subscriptions: {
          some: {
            status: { in: ["pending", "active"] },
            deletedAt: null,
            group: { branchId: inIds },
          },
        },
      },
    ],
  }
}

/**
 * Видимость клиента для текущего scope (ADM-04, модель Анны):
 *   • владелец/управляющий/админ без привязок (mode "all") → {} (видят всех);
 *   • админ, у кого отмечены ВСЕ филиалы (coversAllBranches) → {} (видит всех,
 *     включая безфилиальных — решение владельца 13.08.2026);
 *   • частичный scope → clientInBranch(branchIds).
 */
export function scopeClientByBranch(
  scope: BranchScope,
): Prisma.ClientWhereInput {
  if (isUnscoped(scope)) return {}
  if (scope.coversAllBranches) return {}
  return clientInBranch(scope.branchIds)
}
