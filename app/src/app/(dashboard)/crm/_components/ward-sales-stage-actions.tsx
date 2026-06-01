"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Wallet } from "lucide-react"
import { AwaitingPaymentDialog } from "./awaiting-payment-dialog"

/**
 * Кнопка перевода подопечного в «Ожидание оплаты».
 *
 * Доступна только из «Заявка» или «Прошёл пробное» (PRD §sales).
 * Из «Пробное записано» сперва нужно отметить пробное (привычный flow).
 * Из «Ожидаем оплату»/«Активный» — нет смысла.
 *
 * Раньше компонент был селектором всех стадий, но переходы стали
 * осмысленными (создают абонемент/зачисление), поэтому селектор заменён
 * на одну кнопку, которая открывает модалку с обязательными полями.
 */
export function WardSalesStageActions({
  wardId,
  wardName,
  currentStage,
  defaultBranchId,
  defaultDirectionId,
  defaultGroupId,
  disabled = false,
}: {
  wardId: string
  wardName?: string
  currentStage: string
  defaultBranchId?: string | null
  defaultDirectionId?: string | null
  defaultGroupId?: string | null
  // Активный абонемент → подопечный вне воронки, кнопка не нужна.
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  if (disabled) return null
  if (currentStage !== "application" && currentStage !== "trial_attended") {
    return null
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Wallet className="size-3.5" />
        В ожидание оплаты
      </Button>
      <AwaitingPaymentDialog
        wardId={wardId}
        wardName={wardName ?? "Подопечный"}
        defaultBranchId={defaultBranchId}
        defaultDirectionId={defaultDirectionId}
        defaultGroupId={defaultGroupId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
