import { redirect } from "next/navigation"

// Старый роут /crm/leads → /crm/funnel.
// Сохраняется для совместимости со старыми ссылками и e2e-тестами.
export default function LeadsRedirect() {
  redirect("/crm/funnel")
}
