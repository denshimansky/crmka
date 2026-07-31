/**
 * Решение об обновлении филиала существующего клиента при merge (этап 2 импорта).
 *
 * Причина (Monkey Space, 31.07.2026): первый импорт проставил филиал всем
 * клиентам, но с ошибочными данными в файле; при переимпорте исправленного файла
 * филиал НЕ менялся, потому что merge бэкфиллил его только при `branchId === null`.
 * Итог — «филиал не привязывается»: исправить ошибочный первый импорт нельзя.
 *
 * Правило:
 *  - филиал из файла не разрешён (пусто) → ничего не меняем;
 *  - в БД филиал пуст → проставляем из файла (бэкфилл, как раньше);
 *  - в БД филиал стоит, но клиент БЕЗ абонементов → филиал был проставлен
 *    импортом, разрешаем КОРРЕКЦИЮ из файла;
 *  - клиент С абонементами → филиал производный от абонементов (lastBranchId/
 *    prevBranchId, ADM-04), импорт его НЕ трогает; расхождение с файлом фиксируем
 *    флагом conflictSkipped (для предупреждения).
 */

export interface ExistingBranchState {
  branchId: string | null
  lastBranchId: string | null
  /** У клиента есть хотя бы один абонемент — тогда филиал производный, не трогаем. */
  hasSubscriptions: boolean
}

export interface BranchUpdateDecision {
  setBranchId: boolean
  setLastBranchId: boolean
  /** Непустой филиал изменён на другой из файла (коррекция ошибочного импорта). */
  corrected: boolean
  /** Файл хочет другой филиал, но у клиента есть абонементы — оставили прежний. */
  conflictSkipped: boolean
}

export function decideBranchUpdate(
  existing: ExistingBranchState,
  resolvedBranchId: string | null,
): BranchUpdateDecision {
  if (resolvedBranchId === null) {
    return { setBranchId: false, setLastBranchId: false, corrected: false, conflictSkipped: false }
  }

  const correctable = !existing.hasSubscriptions
  const branchDiffers = existing.branchId !== null && existing.branchId !== resolvedBranchId
  const lastDiffers = existing.lastBranchId !== null && existing.lastBranchId !== resolvedBranchId

  const setBranchId = existing.branchId === null || (correctable && branchDiffers)
  const setLastBranchId = existing.lastBranchId === null || (correctable && lastDiffers)

  const corrected =
    (setBranchId && existing.branchId !== null) || (setLastBranchId && existing.lastBranchId !== null)
  const conflictSkipped = !correctable && branchDiffers

  return { setBranchId, setLastBranchId, corrected, conflictSkipped }
}
