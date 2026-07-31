import { wasEverClient } from "./was-ever-client"

// Воронковые «бакеты», при переходе в которые рабочий статус (active/churned)
// теряет смысл и обнуляется, чтобы метка отражала выбранный бакет. active_client
// сюда НЕ входит — при выводе в «Выбывшие» clientStatus=churned должен сохраниться.
const FUNNEL_BUCKETS = ["new", "non_target", "archived", "blacklisted"]
const TERMINAL = ["blacklisted", "archived"]

export type PlanExisting = {
  funnelStatus: string
  clientStatus: string | null
  firstPaymentDate: Date | null
  firstPaidLessonDate: Date | null
}

export type TransitionPlan =
  | { error: string; httpStatus: number }
  | { funnelStatusInject: "active_client" | null; clearClientStatus: boolean }

/**
 * Решение по правилам «бывшего клиента» для PATCH /api/clients/[id].
 * Чистая функция — единый источник правды, ловит и UI, и прямые вызовы API.
 */
export function planFormerClientTransition(input: {
  existing: PlanExisting
  patchFunnelStatus?: string
  patchClientStatus?: string | null // undefined = поле не пришло в теле
  role: string
}): TransitionPlan {
  const { existing, patchFunnelStatus, patchClientStatus, role } = input
  const wasClient = wasEverClient(existing)

  // R1: бывшего клиента нельзя вернуть в «Потенциальный» (переход именно В potential).
  if (wasClient && patchFunnelStatus === "potential" && existing.funnelStatus !== "potential") {
    return { error: "Бывшего клиента нельзя вернуть в «Потенциальный»", httpStatus: 400 }
  }

  // R2: «В Выбывшие» из ЧС/Архива — выводим из терминала (funnel→active_client),
  // право — владелец/управляющий (как возврат из ЧС/Архива).
  const churningFromTerminal =
    patchClientStatus === "churned" &&
    existing.clientStatus !== "churned" &&
    TERMINAL.includes(existing.funnelStatus)
  if (churningFromTerminal && role !== "owner" && role !== "manager") {
    return {
      error: "Только владелец или управляющий может вывести клиента из чёрного списка или архива",
      httpStatus: 403,
    }
  }
  const funnelStatusInject: "active_client" | null = churningFromTerminal ? "active_client" : null

  // Очистка clientStatus при переводе в воронковый бакет (Лид/Не целевой/Архив/ЧС),
  // если clientStatus не задан явно телом. active_client (инъекция) не бакет →
  // clientStatus=churned сохраняется.
  const effectiveFunnel = funnelStatusInject ?? patchFunnelStatus
  const clearClientStatus =
    !!effectiveFunnel && FUNNEL_BUCKETS.includes(effectiveFunnel) && patchClientStatus === undefined

  return { funnelStatusInject, clearClientStatus }
}
